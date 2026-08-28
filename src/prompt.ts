import { GitContext } from './git';

const BASE_SYSTEM_PROMPT = [
  'You write git commit messages.',
  'You have no tools, MCP servers, or skills. Do not try to read files, run commands, or call tools.',
  'Reply with only the commit message text that should be passed to git commit.',
  'Do not wrap it in markdown, quotes, or code fences.',
  'Do not add a preamble, explanation, or commentary.',
].join(' ');

export function buildSystemPrompt(instructions?: string): string {
  const extra = instructions?.trim();
  if (!extra) {
    return BASE_SYSTEM_PROMPT;
  }

  return [
    BASE_SYSTEM_PROMPT,
    '',
    'Repository instructions (these take precedence over matching recent commit style when they conflict):',
    extra,
  ].join('\n');
}

export function buildUserPrompt(context: GitContext): string {
  const style = context.recentCommits
    ? [
        'Match the style of recent commits in this repository when they form a consistent pattern.',
        'If they are inconsistent, use Conventional Commits: type(optional-scope): summary.',
        '',
        'Recent commits (newest first):',
        context.recentCommits,
      ].join('\n')
    : 'Use Conventional Commits: type(optional-scope): summary.';

  const sourceLabel =
    context.source === 'staged'
      ? 'Staged changes'
      : 'Unstaged working tree changes (nothing was staged)';

  return [
    `Write a commit message for the current ${context.source} changes on branch ${context.branch}.`,
    '',
    style,
    '',
    'Subject line under 72 characters. Add a body only when the change needs it, separated by a blank line.',
    'Be specific about what changed and why. Do not mention that an AI wrote this.',
    '',
    `${sourceLabel}:`,
    context.files || '(file list unavailable)',
    '',
    'Diff:',
    context.diff,
  ].join('\n');
}

export function buildCodexPrompt(context: GitContext, instructions?: string): string {
  return `${buildSystemPrompt(instructions)}\n\n${buildUserPrompt(context)}`;
}
