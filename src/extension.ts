import * as vscode from 'vscode';
import { loadConfig } from './config';
import { generateCommitMessage, providerLabel } from './generate';
import { collectGitContext } from './git';
import { Logger } from './logger';
import { selectModel } from './selectModel';

interface GitExtension {
  getAPI(version: 1): GitAPI;
}

interface GitAPI {
  repositories: Repository[];
}

interface Repository {
  rootUri: vscode.Uri;
  inputBox: { value: string };
}

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel('CLI Commit');
  const logger = new Logger(channel, () => loadConfig().debug);

  const disposable = vscode.commands.registerCommand('cli-commit.generate', async (arg?: unknown) => {
    let debug = false;

    try {
      const repo = await resolveRepository(arg);
      if (!repo) {
        return;
      }

      const config = loadConfig(repo.rootUri);
      debug = config.debug;
      if (debug) {
        channel.show(true);
      }

      const gitContext = await collectGitContext(
        repo.rootUri.fsPath,
        config.recentCommitCount,
        config.fallbackToUnstaged,
        logger,
      );

      if (gitContext.source === 'unstaged') {
        logger.info('Nothing staged; using the working tree diff.');
      }

      const generated = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Generating commit message',
          cancellable: true,
        },
        async (progress, token) => generateCommitMessage(gitContext, config, logger, progress, token),
      );

      logger.info(`Generated with ${providerLabel(generated.provider, config)}: ${generated.message}`);
      repo.inputBox.value = generated.message;

      if (generated.usedFallback) {
        vscode.window.setStatusBarMessage(
          `CLI Commit used ${providerLabel(generated.provider, config)} after ${config.provider === 'claude' ? 'Claude' : 'Codex'} failed`,
          6000,
        );
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (text === 'Cancelled') {
        return;
      }
      logger.error(text);
      if (debug) {
        logger.show();
      }
      vscode.window.showErrorMessage(`CLI Commit: ${text}`);
    }
  });

  const selectModelCommand = vscode.commands.registerCommand('cli-commit.selectModel', async () => {
    try {
      await selectModel();
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      logger.error(text);
      vscode.window.showErrorMessage(`CLI Commit: ${text}`);
    }
  });

  context.subscriptions.push(disposable, selectModelCommand, channel);
}

export function deactivate(): void {}

async function resolveRepository(arg: unknown): Promise<Repository | undefined> {
  const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!gitExtension) {
    vscode.window.showErrorMessage('CLI Commit: the built-in Git extension is not available.');
    return undefined;
  }

  const git = (gitExtension.isActive ? gitExtension.exports : await gitExtension.activate()).getAPI(1);
  if (!git.repositories.length) {
    vscode.window.showErrorMessage('CLI Commit: open a folder that is a Git repository.');
    return undefined;
  }

  const fromArg = repositoryFromArg(git.repositories, arg);
  if (fromArg) {
    return fromArg;
  }

  if (git.repositories.length === 1) {
    return git.repositories[0];
  }

  const picked = await vscode.window.showQuickPick(
    git.repositories.map((repo) => ({
      label: repo.rootUri.fsPath,
      repo,
    })),
    { placeHolder: 'Select the repository to generate a commit message for' },
  );

  return picked?.repo;
}

function repositoryFromArg(repositories: Repository[], arg: unknown): Repository | undefined {
  if (!arg) {
    return undefined;
  }

  if (typeof arg === 'object' && arg !== null && 'rootUri' in arg && 'inputBox' in arg) {
    return arg as Repository;
  }

  const uri = uriFromArg(arg);
  if (!uri) {
    return undefined;
  }

  return repositories
    .filter((repo) => uri.fsPath.startsWith(repo.rootUri.fsPath))
    .sort((a, b) => b.rootUri.fsPath.length - a.rootUri.fsPath.length)[0];
}

function uriFromArg(arg: unknown): vscode.Uri | undefined {
  if (arg instanceof vscode.Uri) {
    return arg;
  }

  if (typeof arg === 'object' && arg !== null) {
    const record = arg as { rootUri?: vscode.Uri; uri?: vscode.Uri; fsPath?: string };
    if (record.rootUri instanceof vscode.Uri) {
      return record.rootUri;
    }
    if (record.uri instanceof vscode.Uri) {
      return record.uri;
    }
    if (typeof record.fsPath === 'string') {
      return vscode.Uri.file(record.fsPath);
    }
  }

  return undefined;
}
