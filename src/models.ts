import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ProviderId } from './config';

export interface ModelSuggestion {
  value: string;
  detail: string;
}

/**
 * Claude aliases resolve to the latest model of each tier, so this list does not
 * go stale. Codex has no aliases, but the CLI keeps a server-refreshed registry
 * on disk that we read instead — see listCodexModels.
 */
const CLAUDE_ALIASES: ModelSuggestion[] = [
  { value: 'haiku', detail: 'alias — latest Haiku (cheapest)' },
  { value: 'sonnet', detail: 'alias — latest Sonnet' },
  { value: 'opus', detail: 'alias — latest Opus' },
  { value: 'fable', detail: 'alias — latest Fable' },
];

/** Only used when the Codex registry cannot be read. */
const CODEX_FALLBACK: ModelSuggestion[] = [
  { value: 'gpt-5.6-luna', detail: 'GPT-5.6 Luna' },
  { value: 'gpt-5.6-terra', detail: 'GPT-5.6 Terra' },
  { value: 'gpt-5.6-sol', detail: 'GPT-5.6 Sol' },
];

/** Suggestions for the picker. Never a constraint — any string the CLI accepts is valid. */
export async function listModels(provider: ProviderId): Promise<ModelSuggestion[]> {
  if (provider === 'claude') {
    return CLAUDE_ALIASES;
  }

  const fromCache = await listCodexModels();
  return fromCache.length ? fromCache : CODEX_FALLBACK;
}

interface CodexModelEntry {
  slug?: unknown;
  display_name?: unknown;
  description?: unknown;
  priority?: unknown;
}

/**
 * Reads `models_cache.json`, which the Codex CLI refreshes from the server, so
 * new models show up in the picker without an extension release.
 */
export async function listCodexModels(): Promise<ModelSuggestion[]> {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');

  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(path.join(home, 'models_cache.json'), 'utf8'));
  } catch {
    return [];
  }

  const models = (parsed as { models?: unknown })?.models;
  if (!Array.isArray(models)) {
    return [];
  }

  return models
    .map((entry) => entry as CodexModelEntry)
    .filter((entry): entry is CodexModelEntry & { slug: string } => typeof entry.slug === 'string' && !!entry.slug)
    .sort((a, b) => priorityOf(a) - priorityOf(b))
    .map((entry) => ({
      value: entry.slug,
      detail: [entry.display_name, entry.description]
        .filter((part): part is string => typeof part === 'string' && !!part)
        .join(' — '),
    }));
}

function priorityOf(entry: CodexModelEntry): number {
  return typeof entry.priority === 'number' ? entry.priority : Number.MAX_SAFE_INTEGER;
}

/** Pre-0.2.0 shorthands, expanded so existing settings keep working. */
const LEGACY_CODEX_ALIASES: Record<string, string> = {
  sol: 'gpt-5.6-sol',
  terra: 'gpt-5.6-terra',
  luna: 'gpt-5.6-luna',
};

/**
 * The model to pass to `codex -m`, or undefined to let the CLI choose. Falls
 * back to the user's `~/.codex/config.toml` because `--ignore-user-config`
 * (which is there to keep MCP servers and rules out of the call) also discards
 * their default model.
 */
export async function resolveCodexModel(configured: string): Promise<string | undefined> {
  const explicit = configured.trim();
  if (explicit) {
    return LEGACY_CODEX_ALIASES[explicit] ?? explicit;
  }

  return readCodexConfigModel();
}

export async function readCodexConfigModel(): Promise<string | undefined> {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');

  let contents: string;
  try {
    contents = await fs.readFile(path.join(home, 'config.toml'), 'utf8');
  } catch {
    return undefined;
  }

  return parseTopLevelModel(contents);
}

/**
 * Reads the top-level `model` key out of a TOML document. Stops at the first
 * table header so keys under `[profiles.x]` or `[notice.model_migrations]` are
 * never mistaken for the global default.
 */
export function parseTopLevelModel(toml: string): string | undefined {
  for (const rawLine of toml.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('[')) {
      return undefined;
    }

    const match = /^model\s*=\s*(.+)$/.exec(line);
    if (!match) {
      continue;
    }

    const value = stripComment(match[1]).trim();
    const quoted = /^(['"])(.*)\1$/.exec(value);
    const model = (quoted ? quoted[2] : value).trim();
    return model || undefined;
  }

  return undefined;
}

function stripComment(value: string): string {
  if (value.startsWith('"') || value.startsWith("'")) {
    const quote = value[0];
    const end = value.indexOf(quote, 1);
    return end === -1 ? value : value.slice(0, end + 1);
  }

  const hash = value.indexOf('#');
  return hash === -1 ? value : value.slice(0, hash);
}
