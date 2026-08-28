import * as vscode from 'vscode';
import { resolveBinary, runProcess } from './cli';
import { ExtensionConfig } from './config';
import { Logger } from './logger';
import { extractCommitMessage } from './parse';
import { buildSystemPrompt } from './prompt';

export async function generateWithClaude(
  prompt: string,
  repoPath: string,
  config: ExtensionConfig,
  logger: Logger,
  token: vscode.CancellationToken,
): Promise<string> {
  const binary = await resolveBinary('claude', config.claudePath, logger);
  const systemPrompt = buildSystemPrompt(config.instructions);
  const args = [
    '-p',
    '--output-format',
    'json',
    '--model',
    config.claudeModel,
    '--effort',
    config.effort,
    '--tools',
    '',
    '--restricted',
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--setting-sources',
    '',
    '--disable-slash-commands',
    '--no-session-persistence',
    '--no-chrome',
    '--permission-mode',
    'dontAsk',
    '--system-prompt',
    systemPrompt,
  ];

  logger.debug(`claude ${args.filter((arg) => arg !== systemPrompt).join(' ')} [--system-prompt]`);
  if (config.instructions) {
    logger.debug(`Custom instructions:\n${config.instructions}`);
  }
  logger.debug(`cwd: ${repoPath}`);

  const result = await runProcess(binary, args, {
    cwd: repoPath,
    stdin: prompt,
    timeoutMs: config.timeoutMs,
    token,
  });

  logger.debug(`claude exit ${result.code}`);
  if (result.stderr.trim()) {
    logger.debug(`claude stderr: ${truncate(result.stderr)}`);
  }
  logger.debug(`claude stdout: ${truncate(result.stdout)}`);

  const payload = result.stdout.trim() || result.stderr.trim();
  if (!payload) {
    throw new Error('Claude CLI returned no output. Is it authenticated? Try running `claude -p "hello"` in a terminal.');
  }

  return extractCommitMessage(payload);
}

function truncate(text: string, max = 4000): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}… [${text.length} chars]`;
}
