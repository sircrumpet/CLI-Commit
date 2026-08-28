import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { resolveBinary, runProcess } from './cli';
import { ExtensionConfig } from './config';
import { Logger } from './logger';
import { resolveCodexModel } from './models';
import { extractCommitMessage } from './parse';

export async function generateWithCodex(
  prompt: string,
  repoPath: string,
  config: ExtensionConfig,
  logger: Logger,
  token: vscode.CancellationToken,
): Promise<string> {
  const binary = await resolveBinary('codex', config.codexPath, logger);
  const lastMessagePath = path.join(os.tmpdir(), `cli-commit-${process.pid}-${Date.now()}.txt`);
  const model = await resolveCodexModel(config.codexModel);

  const args = [
    'exec',
    '--sandbox',
    'read-only',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--skip-git-repo-check',
    '--color',
    'never',
    ...(model ? ['-m', model] : []),
    '-C',
    repoPath,
    '-c',
    `model_reasoning_effort="${config.effort}"`,
    '-c',
    'mcp_servers={}',
    '-o',
    lastMessagePath,
    '-',
  ];

  if (!model) {
    logger.debug('No Codex model configured; letting the CLI pick its default.');
  }

  logger.debug(`codex ${args.join(' ')}`);
  logger.debug(`cwd: ${repoPath}`);

  try {
    const result = await runProcess(binary, args, {
      cwd: repoPath,
      stdin: prompt,
      timeoutMs: config.timeoutMs,
      token,
    });

    logger.debug(`codex exit ${result.code}`);
    if (result.stderr.trim()) {
      logger.debug(`codex stderr: ${truncate(result.stderr)}`);
    }
    logger.debug(`codex stdout: ${truncate(result.stdout)}`);

    const fromFile = await readLastMessage(lastMessagePath);
    if (fromFile) {
      logger.debug(`codex last message file: ${truncate(fromFile)}`);
      return extractCommitMessage(fromFile);
    }

    const payload = result.stdout.trim() || result.stderr.trim();
    if (!payload) {
      throw new Error('Codex CLI returned no output. Is it authenticated? Try running `codex exec "hello"` in a terminal.');
    }

    return extractCommitMessage(payload);
  } finally {
    await fs.rm(lastMessagePath, { force: true }).catch(() => undefined);
  }
}

async function readLastMessage(filePath: string): Promise<string | undefined> {
  try {
    const contents = (await fs.readFile(filePath, 'utf8')).trim();
    return contents || undefined;
  } catch {
    return undefined;
  }
}

function truncate(text: string, max = 4000): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}… [${text.length} chars]`;
}
