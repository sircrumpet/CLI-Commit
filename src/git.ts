import { runProcess } from './cli';
import { Logger } from './logger';

export interface GitContext {
  repoPath: string;
  branch: string;
  source: 'staged' | 'unstaged';
  files: string;
  diff: string;
  recentCommits: string;
}

const DIFF_CHAR_LIMIT = 80_000;

export async function collectGitContext(
  repoPath: string,
  recentCommitCount: number,
  fallbackToUnstaged: boolean,
  logger: Logger,
): Promise<GitContext> {
  const branch = (await git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim() || 'HEAD';
  let source: 'staged' | 'unstaged' = 'staged';
  let diff = await git(repoPath, ['diff', '--cached']);
  let files = await git(repoPath, ['diff', '--cached', '--name-status']);

  if (!diff.trim()) {
    if (!fallbackToUnstaged) {
      throw new Error('No staged changes. Stage files first, or enable cliCommit.fallbackToUnstaged.');
    }
    diff = await git(repoPath, ['diff']);
    files = await git(repoPath, ['diff', '--name-status']);
    source = 'unstaged';
  }

  if (!diff.trim()) {
    throw new Error('No staged or unstaged changes to summarise.');
  }

  if (diff.length > DIFF_CHAR_LIMIT) {
    logger.debug(`Diff truncated from ${diff.length} to ${DIFF_CHAR_LIMIT} characters`);
    diff = `${diff.slice(0, DIFF_CHAR_LIMIT)}\n\n[diff truncated]`;
  }

  let recentCommits = '';
  if (recentCommitCount > 0) {
    recentCommits = await git(repoPath, [
      'log',
      '-n',
      String(recentCommitCount),
      '--no-merges',
      '--pretty=format:%s',
    ]);
  }

  logger.debug(`Git context: ${source} on ${branch}, ${files.split('\n').filter(Boolean).length} files`);

  return { repoPath, branch, source, files: files.trim(), diff, recentCommits: recentCommits.trim() };
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await runProcess('git', args, { cwd, timeoutMs: 15_000 });
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(detail || `git ${args.join(' ')} failed`);
  }
  return result.stdout;
}
