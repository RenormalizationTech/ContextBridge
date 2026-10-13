import { MAX_ATTACHMENT_BYTES } from './payload.ts';
import type { Attachment, LineRange, NewAttachment } from './types.ts';

// What the chat view shows for each attachment.
export interface AttachmentSummary {
  id: string;
  kind: Attachment['kind'];
  path: string;
  range?: LineRange;
  note?: string;
}

export class AttachmentStore {
  #items: Attachment[] = [];
  #nextId = 1;
  readonly #listeners = new Set<() => void>();

  get items(): readonly Attachment[] {
    return this.#items;
  }

  // Returns false when an identical attachment already exists.
  add(attachment: NewAttachment): boolean {
    if (this.#items.some((existing) => isSame(existing, attachment))) return false;
    this.#items.push({ ...attachment, id: String(this.#nextId++) } as Attachment);
    this.#changed();
    return true;
  }

  remove(id: string): void {
    const count = this.#items.length;
    this.#items = this.#items.filter((item) => item.id !== id);
    if (this.#items.length !== count) this.#changed();
  }

  clear(): void {
    if (this.#items.length === 0) return;
    this.#items = [];
    this.#changed();
  }

  get(id: string): Attachment | undefined {
    return this.#items.find((item) => item.id === id);
  }

  summaries(): AttachmentSummary[] {
    return this.#items.map((item) => ({
      id: item.id,
      kind: item.kind,
      path: item.path,
      range: item.kind === 'selection' ? item.range : undefined,
      note:
        item.kind === 'file' && item.sizeBytes > MAX_ATTACHMENT_BYTES
          ? `Too large (${formatBytes(item.sizeBytes)}): sent as a reference only`
          : undefined,
    }));
  }

  onDidChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #changed(): void {
    for (const listener of this.#listeners) listener();
  }
}

function isSame(a: NewAttachment, b: NewAttachment): boolean {
  if (a.kind !== b.kind || a.uri !== b.uri) return false;
  if (a.kind === 'selection' && b.kind === 'selection') {
    return a.range.start === b.range.start && a.range.end === b.range.end;
  }
  return true;
}

export function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`;
}
