import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TranscriptMessage } from '../src/chat/messages.ts';
import { modeRecap } from '../src/chat/modeRecap.ts';
import type { Mode } from '../src/providers/types.ts';

function turn(mode: Mode, question: string, answer: string, cancelled = false): TranscriptMessage[] {
  return [
    { type: 'start', provider: 'Antigravity', mode, question, attachments: ['private-context.txt'], at: 1 },
    { type: 'tool', name: 'command', detail: 'private tool operation' },
    { type: 'text', text: answer },
    { type: 'done', cancelled, at: 2 },
  ];
}

test('a mode resumes with only unseen turns and a fresh mode gets recent completed questions and answers', () => {
  const transcript = [
    ...turn('ask', 'First Ask question', 'First answer'),
    ...turn('agent', 'Agent question', 'Agent answer'),
    ...turn('ask', 'Cancelled question', 'Partial answer', true),
  ];
  assert.match(modeRecap(transcript, 'ask', true), /Agent answer/);
  assert.doesNotMatch(modeRecap(transcript, 'ask', true), /First answer|Cancelled|private/);
  assert.match(modeRecap(transcript, 'agent', false), /First answer.*Agent answer/s);
  const long = Array.from({ length: 20 }, (_, index) => turn('agent', `question ${index}`, 'X'.repeat(3000))).flat();
  assert.ok(modeRecap(long, 'ask', false).length <= 8000);
  assert.match(modeRecap(long, 'ask', false), /question 19/);
  const escaped = modeRecap(turn('agent', 'Newest question', '<'.repeat(2400)), 'ask', false);
  assert.match(escaped, /Newest question/);
  assert.doesNotMatch(escaped, /</);
});
