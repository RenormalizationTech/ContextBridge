import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { StoredConversation } from './conversation.ts';

export interface ConversationSummary {
  id: string;
  title: string;
  providerId: string;
  updatedAt: number;
}

// Saved chats for one workspace: one JSON file per chat, like VS Code's own chat history.
export class HistoryStore {
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
  }

  async save(conversation: StoredConversation): Promise<void> {
    await mkdir(this.#dir, { recursive: true });
    const file = this.#file(conversation.id);
    await writeFile(file, JSON.stringify(conversation));
  }

  async load(id: string): Promise<StoredConversation | undefined> {
    try {
      const data = JSON.parse(await readFile(this.#file(id), 'utf8'));
      return data?.version === 1 && Array.isArray(data.messages) ? data : undefined;
    } catch {
      return undefined;
    }
  }

  // Newest first. Unreadable files are skipped.
  async list(): Promise<ConversationSummary[]> {
    let names: string[];
    try {
      names = (await readdir(this.#dir)).filter((name) => name.endsWith('.json'));
    } catch {
      return [];
    }
    const loaded = await Promise.all(names.map((name) => this.load(name.slice(0, -'.json'.length))));
    return loaded
      .filter((item): item is StoredConversation => item !== undefined)
      .map(({ id, title, providerId, updatedAt }) => ({ id, title, providerId, updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async delete(id: string): Promise<void> {
    await rm(this.#file(id), { force: true });
  }

  async clear(): Promise<void> {
    await rm(this.#dir, { recursive: true, force: true });
  }

  // Keeps the newest `max` chats and deletes the rest.
  async prune(max: number): Promise<void> {
    const all = await this.list();
    await Promise.all(all.slice(Math.max(0, max)).map((item) => this.delete(item.id)));
  }

  #file(id: string): string {
    if (!/^[\w-]+$/.test(id)) throw new Error(`Invalid chat id: ${id}`);
    return join(this.#dir, `${id}.json`);
  }
}
