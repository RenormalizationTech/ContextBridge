import { codexError, unwrapShell } from './codexOutput.ts';
import type { ProviderEvent } from './types.ts';

// Turns `codex app-server` notifications into provider events. Unlike `codex exec --json`, the app
// server streams answer text as `item/agentMessage/delta`.
export class CodexAppServerParser {
  turnId?: string;
  finished = false;
  // Last fatal `error` notification, used if the turn fails without its own message.
  lastError?: string;
  #textItem?: string;
  #fileChanges = new Map<string, string[]>();

  handle(method: string, params: any): ProviderEvent[] {
    switch (method) {
      case 'turn/started':
        this.turnId = params.turn?.id;
        return [];
      case 'item/agentMessage/delta': {
        // Separate consecutive messages (e.g. commentary, then the final answer).
        const prefix = this.#textItem !== undefined && this.#textItem !== params.itemId ? '\n\n' : '';
        this.#textItem = params.itemId;
        return params.delta ? [{ type: 'text', text: prefix + params.delta }] : [];
      }
      case 'item/started':
        return this.#itemStarted(params.item ?? {});
      case 'item/completed':
        // A web search's query is only known once it finishes.
        return params.item?.type === 'webSearch' ? webSearchEvent(params.item) : [];
      case 'error':
        if (!params.willRetry) this.lastError = params.error?.message;
        return [];
      case 'turn/completed': {
        this.finished = true;
        const turn = params.turn ?? {};
        if (turn.status === 'interrupted') return [{ type: 'done', cancelled: true }];
        if (turn.status === 'failed') return [codexError(turn.error?.message ?? this.lastError ?? 'Codex failed to answer.')];
        return [{ type: 'done', cancelled: false }];
      }
      default:
        return [];
    }
  }

  // Paths of a file change item, for approval cards.
  filesFor(itemId: string): string[] {
    return this.#fileChanges.get(itemId) ?? [];
  }

  #itemStarted(item: any): ProviderEvent[] {
    switch (item.type) {
      case 'commandExecution':
        return [{ type: 'tool', name: 'Shell', detail: unwrapShell(item.command ?? '') }];
      case 'fileChange': {
        const paths = (item.changes ?? []).map((change: any) => change.path).filter(Boolean);
        this.#fileChanges.set(item.id, paths);
        return [{ type: 'tool', name: 'Edit', detail: paths.join(', ') }];
      }
      case 'mcpToolCall':
        return [{ type: 'tool', name: `${item.server}: ${item.tool}`, detail: '' }];
      case 'webSearch':
        return item.query ? webSearchEvent(item) : [];
      default:
        return [];
    }
  }
}

function webSearchEvent(item: any): ProviderEvent[] {
  const action = item.action ?? {};
  const detail = item.query || action.query || action.url || '';
  return [{ type: 'tool', name: action.type === 'openPage' || action.type === 'open_page' ? 'Open page' : 'Web search', detail }];
}
