import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linkAddress, resolveFileLink } from '../src/chat/links.ts';

const root = '/Users/me/Project';

test('resolves relative file links against the workspace', () => {
  assert.deepEqual(resolveFileLink('docs/MANUAL_TESTING.md', root), { path: '/Users/me/Project/docs/MANUAL_TESTING.md', line: undefined });
  assert.deepEqual(resolveFileLink('./src/a%20b.ts', root), { path: '/Users/me/Project/src/a b.ts', line: undefined });
});

test('keeps absolute file links as they are', () => {
  assert.deepEqual(resolveFileLink('/Users/me/Project/docs/MANUAL_TESTING.md', root), { path: '/Users/me/Project/docs/MANUAL_TESTING.md', line: undefined });
});

test('reads the line from #L and :line suffixes', () => {
  assert.equal(resolveFileLink('src/a.ts#L12', root)?.line, 11);
  assert.equal(resolveFileLink('src/a.ts#L12-L20', root)?.line, 11);
  assert.equal(resolveFileLink('/Users/me/Project/src/a.ts:7', root)?.line, 6);
  assert.equal(resolveFileLink('src/a.ts:7:3', root)?.line, 6);
  assert.equal(resolveFileLink('src/a.ts:7', root)?.path, '/Users/me/Project/src/a.ts');
});

test('ignores links with a scheme', () => {
  assert.equal(resolveFileLink('command:workbench.action.quit', root), undefined);
  assert.equal(resolveFileLink('mailto:a@b.c', root), undefined);
});

test('link addresses: file links become absolute paths, others stay as written', () => {
  assert.equal(linkAddress('src/a%20b.ts', root), '/Users/me/Project/src/a b.ts');
  assert.equal(linkAddress('src/a.ts#L12-L20', root), '/Users/me/Project/src/a.ts:12');
  assert.equal(linkAddress('/Users/me/Project/src/a.ts:7:3', root), '/Users/me/Project/src/a.ts:7');
  assert.equal(linkAddress('https://example.com/a?b=1', root), 'https://example.com/a?b=1');
  assert.equal(linkAddress('mailto:a@b.c', root), 'mailto:a@b.c');
  assert.equal(linkAddress('src/a.ts', undefined), 'src/a.ts');
});
