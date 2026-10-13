import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPrompt } from '../src/context/payload.ts';
import { MockProvider } from '../src/providers/mockProvider.ts';
import type { ProviderEvent } from '../src/providers/types.ts';

const request = {
  prompt: buildPrompt([{ path: 'a.ts', text: 'x' }], 'Explain a.ts'),
  cwd: '/workspace',
};

test('streams text and ends with a single done event', async () => {
  const events: ProviderEvent[] = [];
  await new MockProvider(0).ask(request, (event) => events.push(event), new AbortController().signal);
  const text = events.flatMap((event) => (event.type === 'text' ? [event.text] : [])).join('');
  assert.ok(events.filter((event) => event.type === 'text').length > 1, 'streams in several chunks');
  assert.match(text, /You asked: "Explain a\.ts"/);
  assert.match(text, /1 attachment\(s\)/);
  assert.deepEqual(events.at(-1), { type: 'done', cancelled: false });
});

test('stops streaming when aborted', async () => {
  const events: ProviderEvent[] = [];
  const controller = new AbortController();
  await new MockProvider(1).ask(
    request,
    (event) => {
      events.push(event);
      if (events.length === 3) controller.abort();
    },
    controller.signal,
  );
  assert.equal(events.filter((event) => event.type === 'text').length, 3);
  assert.deepEqual(events.at(-1), { type: 'done', cancelled: true });
});
