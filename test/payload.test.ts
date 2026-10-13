import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPrompt } from '../src/context/payload.ts';

test('wraps file and selection attachments in order, with line ranges', () => {
  const prompt = buildPrompt(
    [
      { id: '1', path: 'src/calc.py', text: 'def mean(xs): ...' },
      { id: '2', path: 'src/helper.py', text: 'return v * k', range: { start: 2, end: 3 } },
    ],
    'Why does mean() crash?',
  );
  const file = prompt.indexOf('<attachment path="src/calc.py">\ndef mean(xs): ...\n</attachment>');
  const selection = prompt.indexOf('<attachment path="src/helper.py" lines 2-3>\nreturn v * k\n</attachment>');
  assert.ok(file >= 0, 'file attachment present');
  assert.ok(selection > file, 'selection attachment present, after the file');
});

test('states Ask mode and ends with the question', () => {
  const prompt = buildPrompt([], 'What does this do?');
  assert.match(prompt, /This is Ask mode: answer and suggest changes, but do not modify files\./);
  assert.ok(prompt.endsWith('Question: What does this do?'));
  assert.doesNotMatch(prompt, /<attachment/);
});
