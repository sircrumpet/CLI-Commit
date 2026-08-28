import * as vscode from 'vscode';

export type ProviderId = 'claude' | 'codex';
export type ClaudeModel = 'opus' | 'sonnet' | 'haiku';
export type CodexModel = 'sol' | 'terra' | 'luna';
export type Effort = 'low' | 'medium' | 'high';

export interface ExtensionConfig {
  provider: ProviderId;
  claudeModel: ClaudeModel;
  codexModel: CodexModel;
  effort: Effort;
  recentCommitCount: number;
  instructions: string;
  fallbackToUnstaged: boolean;
  fallbackToOtherProvider: boolean;
  timeoutMs: number;
  claudePath: string;
  codexPath: string;
  debug: boolean;
}

export function loadConfig(resource?: vscode.Uri): ExtensionConfig {
  const cfg = vscode.workspace.getConfiguration('cliCommit', resource);
  const timeoutSeconds = clampNumber(cfg.get<number>('timeoutSeconds'), 15, 300, 90);

  return {
    provider: cfg.get<ProviderId>('provider') ?? 'claude',
    claudeModel: cfg.get<ClaudeModel>('claudeModel') ?? 'sonnet',
    codexModel: cfg.get<CodexModel>('codexModel') ?? 'terra',
    effort: cfg.get<Effort>('effort') ?? 'low',
    recentCommitCount: clampNumber(cfg.get<number>('recentCommitCount'), 0, 30, 8),
    instructions: (cfg.get<string>('instructions') ?? '').trim(),
    fallbackToUnstaged: cfg.get<boolean>('fallbackToUnstaged') ?? true,
    fallbackToOtherProvider: cfg.get<boolean>('fallbackToOtherProvider') ?? true,
    timeoutMs: timeoutSeconds * 1000,
    claudePath: (cfg.get<string>('claudePath') ?? '').trim(),
    codexPath: (cfg.get<string>('codexPath') ?? '').trim(),
    debug: cfg.get<boolean>('debug') ?? false,
  };
}

function clampNumber(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}
