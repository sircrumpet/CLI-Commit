import * as vscode from 'vscode';
import { generateWithClaude } from './claude';
import { generateWithCodex } from './codex';
import { ExtensionConfig, ProviderId } from './config';
import { GitContext } from './git';
import { Logger } from './logger';
import { buildCodexPrompt, buildUserPrompt } from './prompt';

export interface GenerateResult {
  message: string;
  provider: ProviderId;
  usedFallback: boolean;
}

export async function generateCommitMessage(
  context: GitContext,
  config: ExtensionConfig,
  logger: Logger,
  progress: vscode.Progress<{ message?: string }>,
  token: vscode.CancellationToken,
): Promise<GenerateResult> {
  const primary = config.provider;
  const secondary = otherProvider(primary);

  progress.report({ message: providerLabel(primary, config) });
  try {
    const message = await runProvider(primary, context, config, logger, token);
    return { message, provider: primary, usedFallback: false };
  } catch (error) {
    throwIfCancelled(error, token);

    if (!config.fallbackToOtherProvider) {
      throw error;
    }

    const primaryError = errorText(error);
    logger.info(`${providerLabel(primary, config)} failed: ${primaryError}`);
    logger.info(`Falling back to ${providerLabel(secondary, config)}…`);
    progress.report({
      message: `${shortName(primary)} failed, trying ${providerLabel(secondary, config)}`,
    });

    try {
      const message = await runProvider(secondary, context, config, logger, token);
      return { message, provider: secondary, usedFallback: true };
    } catch (fallbackError) {
      throwIfCancelled(fallbackError, token);
      const secondaryError = errorText(fallbackError);
      logger.error(`${providerLabel(secondary, config)} failed: ${secondaryError}`);
      throw new Error(
        `${shortName(primary)}: ${primaryError}  ${shortName(secondary)} fallback: ${secondaryError}`,
      );
    }
  }
}

async function runProvider(
  provider: ProviderId,
  context: GitContext,
  config: ExtensionConfig,
  logger: Logger,
  token: vscode.CancellationToken,
): Promise<string> {
  if (provider === 'codex') {
    const prompt = buildCodexPrompt(context, config.instructions);
    logger.debug(`Prompt for Codex (${prompt.length} chars):\n${prompt.slice(0, 1500)}`);
    return generateWithCodex(prompt, context.repoPath, config, logger, token);
  }

  const prompt = buildUserPrompt(context);
  logger.debug(`Prompt for Claude (${prompt.length} chars):\n${prompt.slice(0, 1500)}`);
  return generateWithClaude(prompt, context.repoPath, config, logger, token);
}

export function providerLabel(provider: ProviderId, config: ExtensionConfig): string {
  return provider === 'codex' ? `Codex (${config.codexModel})` : `Claude (${config.claudeModel})`;
}

function otherProvider(provider: ProviderId): ProviderId {
  return provider === 'claude' ? 'codex' : 'claude';
}

function shortName(provider: ProviderId): string {
  return provider === 'claude' ? 'Claude' : 'Codex';
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function throwIfCancelled(error: unknown, token: vscode.CancellationToken): void {
  if (token.isCancellationRequested || errorText(error) === 'Cancelled') {
    throw new Error('Cancelled');
  }
}
