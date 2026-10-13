import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Conversation, isTranscriptMessage } from '../src/chat/conversation.ts';
import { HistoryStore } from '../src/chat/historyStore.ts';
import type { TranscriptMessage } from '../src/chat/messages.ts';

const start = (question: string): TranscriptMessage => ({ type: 'start', question, attachments: [], provider: 'Claude Code', mode: 'ask', at: 1000 });

test('conversation merges streamed text, tracks the open turn, and titles itself', () => {
  const conversation = new Conversation({ providerId: 'claude' });
  assert.equal(conversation.isEmpty, true);
  conversation.append(start('Why does   mean() crash\non empty input?'));
  conversation.append({ type: 'text', text: 'Because ' });
  conversation.append({ type: 'text', text: 'len is 0.' });
  assert.equal(conversation.isAnswering, true);
  conversation.append({ type: 'done', cancelled: false, at: 2000 });
  assert.equal(conversation.isAnswering, false);
  assert.deepEqual(conversation.messages.map((message) => message.type), ['start', 'text', 'done']);
  assert.equal(conversation.messages[1].type === 'text' && conversation.messages[1].text, 'Because len is 0.');
  assert.equal(conversation.title, 'Why does mean() crash on empty input?');
  assert.equal(isTranscriptMessage({ type: 'state' }), false);
  assert.equal(isTranscriptMessage({ type: 'tool' }), true);
});

test('a chat saved mid-answer is closed when loaded, with pending approvals denied', () => {
  const saved = new Conversation({ providerId: 'claude' });
  saved.append(start('Fix it'));
  saved.append({ type: 'permission', id: '7', tool: 'Edit', detail: 'a.py' });
  const loaded = new Conversation(saved.toJSON());
  assert.equal(loaded.isAnswering, false);
  assert.deepEqual(loaded.messages.slice(-2).map((message) => message.type), ['permissionResolved', 'error']);
  assert.equal(saved.isAnswering, true, 'the original is not modified');

  saved.permissionLevel = 'bypass';
  assert.equal(new Conversation(saved.toJSON()).permissionLevel, 'bypass', 'the permission level is saved with the chat');
});

test('history store saves, lists newest first, deletes, prunes, and rejects bad ids', async () => {
  const store = new HistoryStore(join(mkdtempSync(join(tmpdir(), 'cb-history-')), 'chats'));
  assert.deepEqual(await store.list(), []);
  const chats = ['first', 'second', 'third'].map((question, index) => {
    const conversation = new Conversation({ providerId: 'codex' });
    conversation.append(start(question));
    conversation.providerConversationId = `thread-${index}`;
    return { ...conversation.toJSON(), updatedAt: 1000 + index };
  });
  for (const chat of chats) await store.save(chat);

  assert.deepEqual((await store.list()).map((summary) => summary.title), ['third', 'second', 'first']);
  assert.equal((await store.load(chats[0].id))?.providerConversationId, 'thread-0');

  await store.delete(chats[1].id);
  assert.deepEqual((await store.list()).map((summary) => summary.title), ['third', 'first']);

  await store.prune(1);
  assert.deepEqual((await store.list()).map((summary) => summary.title), ['third']);

  assert.equal(await store.load('../escape'), undefined);
  await assert.rejects(store.delete('../escape'), /Invalid chat id/);
  await store.clear();
  assert.deepEqual(await store.list(), []);
});
