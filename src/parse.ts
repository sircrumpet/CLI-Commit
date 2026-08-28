/**
 * Claude `--output-format json` currently emits either a single result object
 * or a JSON array of stream events. Codex `--json` emits JSONL.
 * Always prefer the terminal `result` / last-message payload over dumping raw JSON.
 */
export function extractCommitMessage(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) {
    throw new Error('The CLI returned an empty response.');
  }

  const fromJson = extractFromJsonPayload(trimmed);
  if (fromJson) {
    return finaliseCommitMessage(fromJson);
  }

  const fromNdjson = extractFromNdjson(trimmed);
  if (fromNdjson) {
    return finaliseCommitMessage(fromNdjson);
  }

  return finaliseCommitMessage(trimmed);
}

function extractFromJsonPayload(text: string): string | undefined {
  const jsonStart = text.search(/[\[{]/);
  if (jsonStart < 0) {
    return undefined;
  }

  const candidates = [text, text.slice(jsonStart)];
  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }

    const message = extractFromParsed(parsed);
    if (message) {
      return message;
    }
  }

  return undefined;
}

function extractFromNdjson(text: string): string | undefined {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[i]);
    } catch {
      continue;
    }

    const message = extractFromParsed(parsed);
    if (message) {
      return message;
    }
  }
  return undefined;
}

function extractFromParsed(parsed: unknown): string | undefined {
  if (typeof parsed === 'string') {
    return unwrapStructured(parsed);
  }

  if (Array.isArray(parsed)) {
    for (let i = parsed.length - 1; i >= 0; i--) {
      const item = parsed[i];
      if (isRecord(item) && item.type === 'result') {
        if (item.is_error) {
          throw new Error(String(item.result || item.errors || 'Claude returned an error result.'));
        }
        const fromResult = unwrapStructured(item.result);
        if (fromResult) {
          return fromResult;
        }
      }
    }

    for (let i = parsed.length - 1; i >= 0; i--) {
      const item = parsed[i];
      if (isRecord(item) && item.type === 'rate_limit_event') {
        const info = isRecord(item.rate_limit_info) ? item.rate_limit_info : undefined;
        if (info && (info.status === 'rejected' || info.status === 'blocked')) {
          throw new Error('Claude hit a rate or session limit.');
        }
      }
    }

    for (let i = parsed.length - 1; i >= 0; i--) {
      const fromAssistant = extractAssistantText(parsed[i]);
      if (fromAssistant) {
        return fromAssistant;
      }
    }

    return undefined;
  }

  if (!isRecord(parsed)) {
    return undefined;
  }

  if (parsed.type === 'result' || parsed.subtype === 'success') {
    if (parsed.is_error) {
      throw new Error(String(parsed.result || parsed.errors || 'Claude returned an error result.'));
    }
    const fromResult = unwrapStructured(parsed.result);
    if (fromResult) {
      return fromResult;
    }
  }

  const fromAssistant = extractAssistantText(parsed);
  if (fromAssistant) {
    return fromAssistant;
  }

  return (
    unwrapStructured(parsed.commit_message) ||
    unwrapStructured(parsed.result) ||
    unwrapStructured(parsed.text) ||
    unwrapStructured(parsed.last_agent_message) ||
    unwrapStructured(parsed.message)
  );
}

function extractAssistantText(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const message = isRecord(value.message) ? value.message : value;
  const content = message.content;

  if (typeof content === 'string') {
    return unwrapStructured(content);
  }

  if (Array.isArray(content)) {
    const texts = content
      .map((block) => {
        if (typeof block === 'string') {
          return block;
        }
        if (isRecord(block) && (block.type === 'text' || typeof block.text === 'string')) {
          return String(block.text ?? '');
        }
        return '';
      })
      .filter(Boolean);
    if (texts.length) {
      return unwrapStructured(texts.join('\n'));
    }
  }

  if (typeof value.text === 'string' && value.type !== 'system' && value.type !== 'rate_limit_event') {
    return unwrapStructured(value.text);
  }

  return undefined;
}

function unwrapStructured(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      let inner: unknown;
      try {
        inner = JSON.parse(trimmed);
      } catch {
        return trimmed;
      }
      const nested = extractFromParsed(inner);
      if (nested) {
        return nested;
      }
    }
    return trimmed;
  }

  if (isRecord(value) && typeof value.commit_message === 'string') {
    return value.commit_message.trim();
  }

  return undefined;
}

function finaliseCommitMessage(raw: string): string {
  const cleaned = cleanCommitMessage(raw);
  assertLooksLikeCommitMessage(cleaned);
  assertNotProviderRefusal(cleaned);
  return cleaned;
}

function cleanCommitMessage(raw: string): string {
  let text = raw.trim();

  const fence = text.match(/^```(?:\w+)?\s*\n?([\s\S]*?)\n?```$/);
  if (fence) {
    text = fence[1].trim();
  }

  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1).trim();
  }

  text = text.replace(/^(?:here(?:'| i)?s(?: the)? commit message:?\s*)/i, '').trim();
  return text;
}

function assertLooksLikeCommitMessage(text: string): void {
  const compact = text.replace(/\s+/g, '');
  const looksLikeEventDump =
    (text.startsWith('[{') || text.startsWith('{"type":')) &&
    (text.includes('"session_id"') || text.includes('"type":"result"') || text.includes('"type":"system"'));

  if (looksLikeEventDump || (text.length > 2000 && compact.startsWith('[{'))) {
    throw new Error('Could not extract a commit message from the CLI response. Enable cliCommit.debug and check the CLI Commit output channel.');
  }
}

function assertNotProviderRefusal(text: string): void {
  const first = text.split('\n')[0]?.trim() ?? '';
  if (
    /^(sorry[,.]?\s+)?(i('m| am) (unable|not able)|i cannot|cannot (process|complete|help)|unable to (process|complete)|rate limit|usage limit|overloaded|you('ve| have) hit|quota exceeded|out of (credits|usage|capacity))/i.test(
      first,
    )
  ) {
    throw new Error(first);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
