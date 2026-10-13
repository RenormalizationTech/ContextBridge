import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyLimits, buildPrompt, isBinary, MAX_ATTACHMENT_BYTES, MAX_TOTAL_BYTES } from '../src/context/payload.ts';

test('wraps file and selection attachments in order, with line ranges', () => {
  const prompt = buildPrompt(
    [
      { path: 'src/calc.py', text: 'def mean(xs): ...' },
      { path: 'src/helper.py', text: 'return v * k', range: { start: 2, end: 3 } },
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

test('marks omitted attachments and tells the provider to read them itself', () => {
  const prompt = buildPrompt([{ path: 'big.json', omitted: 'too large to include' }], 'Summarize big.json');
  assert.match(prompt, /<attachment path="big\.json" omitted="too large to include" \/>/);
  assert.match(prompt, /read those files yourself if needed/);
});

test('applyLimits omits oversized attachments and stops at the total limit', () => {
  const big = 'x'.repeat(MAX_ATTACHMENT_BYTES + 1);
  const chunk = 'y'.repeat(MAX_ATTACHMENT_BYTES);
  const result = applyLimits([
    { path: 'small.ts', text: 'ok' },
    { path: 'big.ts', text: big },
    ...Array.from({ length: MAX_TOTAL_BYTES / MAX_ATTACHMENT_BYTES }, (_, i) => ({ path: `part${i}.ts`, text: chunk })),
    { path: 'missing.ts', omitted: 'file not found' },
  ]);
  assert.equal(result[0].text, 'ok');
  assert.deepEqual(result[1], { path: 'big.ts', range: undefined, omitted: 'too large to include' });
  const included = result.filter((attachment) => attachment.text !== undefined).map((attachment) => attachment.path);
  assert.deepEqual(included, ['small.ts', 'part0.ts', 'part1.ts', 'part2.ts']);
  assert.equal(result.at(-2)?.omitted, 'over the total attachment size limit');
  assert.equal(result.at(-1)?.omitted, 'file not found');
});

test('isBinary detects NUL bytes', () => {
  assert.equal(isBinary(new TextEncoder().encode('plain text\n')), false);
  assert.equal(isBinary(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a])), true);
});
