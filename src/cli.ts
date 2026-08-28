import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { Logger } from './logger';

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
  stdin?: string;
  env?: NodeJS.ProcessEnv;
  token?: vscode.CancellationToken;
}

const OUTPUT_CAP = 10 * 1024 * 1024;

export function augmentedPath(): string {
  const home = os.homedir();
  const extras = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    path.join(home, '.local', 'bin'),
    path.join(home, '.cargo', 'bin'),
  ];

  try {
    const nvmRoot = path.join(home, '.nvm', 'versions', 'node');
    const versions = fs.readdirSync(nvmRoot).sort().reverse();
    for (const version of versions) {
      extras.push(path.join(nvmRoot, version, 'bin'));
    }
  } catch {
    // No nvm install.
  }

  const current = process.env.PATH ?? '';
  return [...extras, current].join(path.delimiter);
}

export async function resolveBinary(
  name: string,
  customPath: string | undefined,
  logger: Logger,
): Promise<string> {
  if (customPath) {
    if (!fs.existsSync(customPath)) {
      throw new Error(`Custom ${name} path does not exist: ${customPath}`);
    }
    logger.debug(`Using custom ${name} path: ${customPath}`);
    return customPath;
  }

  const fromLogin = await whichFromLoginShell(name);
  if (fromLogin) {
    logger.debug(`Found ${name} via login shell: ${fromLogin}`);
    return fromLogin;
  }

  const fromPath = await whichFromPath(name);
  if (fromPath) {
    logger.debug(`Found ${name} on PATH: ${fromPath}`);
    return fromPath;
  }

  throw new Error(
    `${name} CLI not found. Install it and make sure it is on your PATH, or set cliCommit.${name}Path in settings.`,
  );
}

async function whichFromLoginShell(name: string): Promise<string | undefined> {
  const shells = [process.env.SHELL, '/bin/zsh', '/bin/bash'].filter(
    (value, index, all): value is string => Boolean(value) && all.indexOf(value) === index,
  );

  for (const shell of shells) {
    if (!fs.existsSync(shell)) {
      continue;
    }
    try {
      const result = await runProcess(shell, ['-lic', `command -v ${name}`], {
        timeoutMs: 8000,
        env: { ...process.env, PATH: augmentedPath() },
      });
      const found = result.stdout.trim().split('\n')[0]?.trim();
      if (result.code === 0 && found && fs.existsSync(found)) {
        return found;
      }
    } catch {
      // Try the next shell.
    }
  }

  return undefined;
}

async function whichFromPath(name: string): Promise<string | undefined> {
  const pathEnv = augmentedPath();
  for (const dir of pathEnv.split(path.delimiter)) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function runProcess(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<RunResult> {
  const { cwd, timeoutMs = 90_000, stdin, env, token } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...env,
        PATH: env?.PATH ?? augmentedPath(),
        TERM: 'dumb',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      cancelSub?.dispose();
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr, code: child.exitCode });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000);
    }, timeoutMs);

    const cancelSub = token?.onCancellationRequested(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000);
    });

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < OUTPUT_CAP) {
        stdout += chunk.toString('utf8');
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < OUTPUT_CAP) {
        stderr += chunk.toString('utf8');
      }
    });
    child.stdin.on('error', () => undefined);
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (token?.isCancellationRequested) {
        finish(new Error('Cancelled'));
        return;
      }
      if (timedOut) {
        finish(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s`));
        return;
      }
      if (code !== 0 && !stdout.trim() && !stderr.trim()) {
        finish(new Error(`${path.basename(command)} exited with code ${code}`));
        return;
      }
      finish();
    });

    try {
      if (stdin !== undefined) {
        child.stdin.write(stdin);
      }
      child.stdin.end();
    } catch {
      // The process may have exited before stdin was written.
    }
  });
}
