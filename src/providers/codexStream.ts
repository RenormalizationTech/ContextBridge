import { codexError, unwrapShell } from './codexOutput.ts';
import type { ProviderEvent } from './types.ts';

// Turns `codex exec --json` events into provider events. Codex sends whole messages, not token deltas.
export class CodexStreamParser {
  threadId?: string;
  finished = false;
  // Last non-fatal error event, reported if the process exits without finishing.
  lastError?: string;
  #wroteText = false;

  handle(event: any): ProviderEvent[] {
    const item = event.item ?? {};
    switch (event.type) {
      case 'thread.started':
        this.threadId = event.thread_id;
        return [];
      case 'item.started':
        return this.#toolEvent(item);
      case 'item.completed':
        if (item.type !== 'agent_message' || !item.text) return [];
        {
          const text = (this.#wroteText ? '\n\n' : '') + item.text;
          this.#wroteText = true;
          return [{ type: 'text', text }];
        }
      case 'turn.completed':
        this.finished = true;
        return [{ type: 'done', cancelled: false }];
      case 'turn.failed':
        this.finished = true;
        return [codexError(event.error?.message ?? 'Codex failed to answer.')];
      case 'error':
        this.lastError = event.message;
        return [];
      default:
        return [];
    }
  }

  #toolEvent(item: any): ProviderEvent[] {
    switch (item.type) {
      case 'command_execution':
        return [{ type: 'tool', name: 'Shell', detail: unwrapShell(item.command ?? '') }];
      case 'mcp_tool_call':
        return [{ type: 'tool', name: `${item.server}: ${item.tool}`, detail: '' }];
      case 'web_search':
        return [{ type: 'tool', name: 'Web search', detail: item.query ?? '' }];
      default:
        return [];
    }
  }
}
