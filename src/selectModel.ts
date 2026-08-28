import * as vscode from 'vscode';
import { ProviderId, loadConfig } from './config';
import { listModels, readCodexConfigModel } from './models';

interface ModelItem extends vscode.QuickPickItem {
  value?: string;
  custom?: boolean;
}

/**
 * A `contributes.configuration` enum is static, so model choice lives here
 * instead: Claude aliases, the Codex CLI's own refreshed registry, and a
 * free-text escape hatch for anything neither source knows about.
 */
export async function selectModel(): Promise<void> {
  const config = loadConfig();
  const provider = config.provider;
  const current = provider === 'codex' ? config.codexModel : config.claudeModel;
  const setting = provider === 'codex' ? 'cliCommit.codexModel' : 'cliCommit.claudeModel';

  const picked = await vscode.window.showQuickPick(await buildItems(provider, current), {
    title: `CLI Commit: model for ${provider === 'codex' ? 'Codex' : 'Claude'}`,
    placeHolder: 'Any model the CLI accepts is valid — this list is only a shortcut',
    matchOnDetail: true,
  });

  if (!picked) {
    return;
  }

  const value = picked.custom ? await promptForModel(current) : picked.value;
  if (value === undefined) {
    return;
  }

  await vscode.workspace
    .getConfiguration()
    .update(setting, value, vscode.ConfigurationTarget.Global);

  vscode.window.setStatusBarMessage(
    value ? `CLI Commit: ${setting.split('.')[1]} set to ${value}` : `CLI Commit: using the CLI default`,
    4000,
  );
}

async function buildItems(provider: ProviderId, current: string): Promise<ModelItem[]> {
  const items: ModelItem[] = (await listModels(provider)).map((suggestion) => ({
    label: suggestion.value,
    detail: suggestion.detail,
    value: suggestion.value,
    description: suggestion.value === current ? 'current' : undefined,
  }));

  if (current && !items.some((item) => item.value === current)) {
    items.unshift({ label: current, detail: 'set in your settings', value: current, description: 'current' });
  }

  items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
  items.push({
    label: 'Use the CLI default',
    detail: await defaultDetail(provider),
    value: '',
    description: current ? undefined : 'current',
  });
  items.push({ label: 'Enter a custom model id…', detail: 'Anything the CLI accepts', custom: true });

  return items;
}

async function defaultDetail(provider: ProviderId): Promise<string> {
  if (provider === 'claude') {
    return 'Omit --model and let the Claude CLI decide';
  }

  const fromConfig = await readCodexConfigModel();
  return fromConfig
    ? `Omit -m and use ${fromConfig} from ~/.codex/config.toml`
    : 'Omit -m and let the Codex CLI decide';
}

async function promptForModel(current: string): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    title: 'CLI Commit: custom model',
    prompt: 'Model id or alias passed straight to the CLI',
    value: current,
    ignoreFocusOut: true,
  });

  return value?.trim();
}
