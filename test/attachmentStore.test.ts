import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AttachmentStore } from '../src/context/attachmentStore.ts';
import { MAX_ATTACHMENT_BYTES } from '../src/context/payload.ts';

const file = { kind: 'file', uri: 'file:///w/a.ts', path: 'a.ts', sizeBytes: 10 } as const;
const selection = { kind: 'selection', uri: 'file:///w/a.ts', path: 'a.ts', range: { start: 2, end: 4 }, text: 'x' } as const;

test('ignores duplicates but allows a file and a selection from it', () => {
  const store = new AttachmentStore();
  assert.equal(store.add(file), true);
  assert.equal(store.add({ ...file }), false);
  assert.equal(store.add(selection), true);
  assert.equal(store.add({ ...selection, text: 'changed' }), false);
  assert.equal(store.add({ ...selection, range: { start: 2, end: 5 } }), true);
  assert.equal(store.items.length, 3);
});

test('removes, clears, and notifies only on real changes', () => {
  const store = new AttachmentStore();
  let changes = 0;
  store.onDidChange(() => changes++);
  store.add(file);
  store.add(selection);
  store.remove('missing');
  store.remove(store.items[0].id);
  assert.deepEqual(store.items.map((item) => item.kind), ['selection']);
  store.clear();
  store.clear();
  assert.equal(store.items.length, 0);
  assert.equal(changes, 4);
});

test('summaries flag files that will be sent as references only', () => {
  const store = new AttachmentStore();
  store.add({ ...file, sizeBytes: MAX_ATTACHMENT_BYTES + 1 });
  store.add(selection);
  const [big, sel] = store.summaries();
  assert.match(big.note ?? '', /reference only/);
  assert.deepEqual(sel.range, { start: 2, end: 4 });
  assert.equal(sel.note, undefined);
});
