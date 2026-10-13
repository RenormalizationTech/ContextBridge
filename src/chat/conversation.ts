import type { TranscriptMessage } from './messages.ts';

// A chat as saved to disk: the transcript plus the CLI conversation to resume.
export interface StoredConversation {
  version: 1;
  id: string;
  title: string;
  providerId: string;
  // Claude session / Codex thread id, so follow-ups continue the same CLI conversation.
  providerConversationId?: string;
  createdAt: number;
  updatedAt: number;
  messages: TranscriptMessage[];
}

const TRANSCRIPT_TYPES = new Set(['start', 'notice', 'permission', 'permissionResolved', 'text', 'tool', 'done', 'error']);

export function isTranscriptMessage(message: { type: string }): message is TranscriptMessage {
  return TRANSCRIPT_TYPES.has(message.type);
}

export class Conversation {
  readonly id: string;
  readonly createdAt: number;
  providerId: string;
  providerConversationId?: string;
  updatedAt: number;
  readonly messages: TranscriptMessage[];

  constructor(init: { providerId: string } | StoredConversation) {
    if ('messages' in init) {
      this.id = init.id;
      this.createdAt = init.createdAt;
      this.updatedAt = init.updatedAt;
      this.providerId = init.providerId;
      this.providerConversationId = init.providerConversationId;
      this.messages = init.messages.map((message) => ({ ...message }));
      this.#closeInterruptedTurn();
    } else {
      this.id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      this.createdAt = this.updatedAt = Date.now();
      this.providerId = init.providerId;
      this.messages = [];
    }
  }

  get isEmpty(): boolean {
    return !this.messages.some((message) => message.type === 'start');
  }

  // A turn is in progress when the last question has no done/error yet.
  get isAnswering(): boolean {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const type = this.messages[i].type;
      if (type === 'done' || type === 'error') return false;
      if (type === 'start') return true;
    }
    return false;
  }

  get title(): string {
    const first = this.messages.find((message) => message.type === 'start');
    const question = first?.type === 'start' ? first.question.replace(/\s+/g, ' ').trim() : '';
    return question.length > 80 ? `${question.slice(0, 79)}…` : question || 'Empty chat';
  }

  // Consecutive text chunks are merged so saved transcripts stay small.
  append(message: TranscriptMessage): void {
    const last = this.messages.at(-1);
    if (message.type === 'text' && last?.type === 'text') last.text += message.text;
    else this.messages.push({ ...message });
    this.updatedAt = Date.now();
  }

  toJSON(): StoredConversation {
    return {
      version: 1,
      id: this.id,
      title: this.title,
      providerId: this.providerId,
      providerConversationId: this.providerConversationId,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      messages: this.messages,
    };
  }

  // A chat saved mid-answer (e.g. VS Code closed) ends with an open turn and maybe pending approvals.
  #closeInterruptedTurn(): void {
    if (!this.isAnswering) return;
    const resolved = new Set(this.messages.flatMap((message) => (message.type === 'permissionResolved' ? [message.id] : [])));
    for (const message of [...this.messages]) {
      if (message.type === 'permission' && !resolved.has(message.id)) this.messages.push({ type: 'permissionResolved', id: message.id, allow: false });
    }
    this.messages.push({ type: 'error', message: 'Interrupted: VS Code closed before this answer finished.', at: this.updatedAt });
  }
}
