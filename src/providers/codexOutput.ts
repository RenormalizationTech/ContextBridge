import type { ProviderEvent } from './types.ts';

// Helpers shared by the `codex exec --json` and `codex app-server` parsers.

// `/bin/zsh -lc "cat a.py"` -> `cat a.py`
export function unwrapShell(command: string): string {
  const match = command.match(/^\S+ -l?c (["'])([\s\S]*)\1$/);
  if (!match) return command;
  return match[1] === '"' ? match[2].replace(/\\(["\\$`])/g, '$1') : match[2];
}

// Codex passes API errors through as JSON text (`{"type":"error","status":400,"error":{"message":…}}`);
// shows the inner message, and flags a model the account can't use so the chat can drop it.
export function codexError(raw: string): ProviderEvent {
  let message = raw;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.error?.message === 'string') message = parsed.error.message;
  } catch {
    // Not JSON: already readable.
  }
  const modelUnavailable = /\bmodel\b.*\b(not supported|not found|does not exist|not available|no access)/i.test(message);
  return { type: 'error', message, ...(modelUnavailable && { modelUnavailable: true }) };
}
