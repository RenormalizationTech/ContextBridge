import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, renameSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseNumstat, readWorkspaceChanges } from '../src/git/workspaceChanges.ts';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'contextbridge-changes-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } });
  git('init', '-q');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  return { root, git };
}

test('numstat preserves unusual filenames, binary entries, and rename paths', () => {
  assert.deepEqual(parseNumstat('2\t1\ta\tb\nc.ts\0-\t-\tpicture.bin\x000\t0\t\0old.ts\0new.ts\0'), [
    { path: 'a\tb\nc.ts', originalPath: undefined, additions: 2, deletions: 1, binary: false },
    { path: 'picture.bin', originalPath: undefined, additions: 0, deletions: 0, binary: true },
    { path: 'new.ts', originalPath: 'old.ts', additions: 0, deletions: 0, binary: false },
  ]);
});

test('summary combines staged and unstaged changes once, includes new/deleted/binary files, and preserves the index', async () => {
  const { root, git } = fixture();
  try {
    writeFileSync(join(root, 'edit.txt'), 'one\ntwo\n');
    writeFileSync(join(root, 'gone.txt'), 'gone\n');
    git('add', '-A'); git('commit', '-qm', 'Initial');
    writeFileSync(join(root, 'edit.txt'), 'one\nstaged\n'); git('add', 'edit.txt');
    writeFileSync(join(root, 'edit.txt'), 'one\nstaged\nworking\n');
    rmSync(join(root, 'gone.txt'));
    writeFileSync(join(root, 'new.txt'), 'new\nno final newline');
    writeFileSync(join(root, 'binary'), Buffer.from([0, 1, 2]));
    const before = readFileSync(join(root, '.git', 'index'));
    const result = await readWorkspaceChanges(root);
    assert.equal(result.files.length, 4);
    assert.equal(result.additions, 4);
    assert.equal(result.deletions, 2);
    assert.equal(result.files.find(f => f.path === 'binary')?.binary, true);
    assert.equal(result.files.find(f => f.path === 'gone.txt')?.deleted, true);
    assert.equal(result.files.find(f => f.path === 'new.txt')?.added, true);
    assert.deepEqual(readFileSync(join(root, '.git', 'index')), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('rename is one changed file with its original path; clean repos have no changes', async () => {
  const { root, git } = fixture();
  try {
    writeFileSync(join(root, 'old.txt'), 'unchanged\n');
    git('add', '-A'); git('commit', '-qm', 'Initial');
    assert.equal((await readWorkspaceChanges(root)).files.length, 0);
    renameSync(join(root, 'old.txt'), join(root, 'new.txt')); git('add', '-A');
    const result = await readWorkspaceChanges(root);
    assert.equal(result.files.length, 1);
    assert.equal(result.files[0].originalPath, 'old.txt');
    assert.equal(result.files[0].added, false);
    assert.equal(result.additions + result.deletions, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('initial repositories include staged and untracked files without requiring HEAD', async () => {
  const { root, git } = fixture();
  try {
    writeFileSync(join(root, 'staged.txt'), 'first\n'); git('add', 'staged.txt');
    writeFileSync(join(root, 'new.txt'), 'second\n');
    const result = await readWorkspaceChanges(root);
    assert.equal(result.files.length, 2);
    assert.equal(result.additions, 2);
    assert.equal(result.head, undefined);
    assert.ok(result.files.every(f => f.added));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
