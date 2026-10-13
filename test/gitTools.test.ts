import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gitArgs, gitCommandLine } from '../src/git/gitTools.ts';
import { ClaudeStreamParser } from '../src/providers/claudeStream.ts';

test('git tools build fixed read-only commands', () => {
  assert.deepEqual(gitArgs('git_status', {}), ['status', '--short', '--branch']);
  assert.deepEqual(gitArgs('git_diff', {}), ['diff', '--no-ext-diff', '--no-textconv', '--']);
  assert.deepEqual(gitArgs('git_diff', { staged: true, stat: true, base: 'main...HEAD', paths: ['src/a.ts'] }), ['diff', '--no-ext-diff', '--no-textconv', '--cached', '--stat', 'main...HEAD', '--', 'src/a.ts']);
  assert.deepEqual(gitArgs('git_log', { maxCount: 5, revision: 'HEAD~3..HEAD', patch: true }), ['log', '--max-count=5', '--date=iso', '--no-ext-diff', '--no-textconv', '--patch', 'HEAD~3..HEAD', '--']);
  assert.deepEqual(gitArgs('git_show', { revision: 'HEAD~2:src/app.ts' }), ['show', '--no-ext-diff', '--no-textconv', 'HEAD~2:src/app.ts']);
  assert.equal(gitCommandLine('git_diff', { staged: true, paths: ['a.py'] }), 'git diff --cached -- a.py');
  assert.equal(gitCommandLine('git_log', { maxCount: 3 }), 'git log --max-count=3');
});

test('git tools reject anything that could become an option or another command', () => {
  for (const [tool, input] of [
    ['git_diff', { base: '--output=/tmp/x' }],
    ['git_diff', { base: 'HEAD; rm -rf .' }],
    ['git_diff', { base: 'a b' }],
    ['git_diff', { paths: ['--output=x'] }],
    ['git_diff', { paths: 'src' }],
    ['git_diff', { staged: 'yes' }],
    ['git_log', { maxCount: 0 }],
    ['git_log', { maxCount: 1000 }],
    ['git_log', { revision: '-n1' }],
    ['git_show', {}],
    ['git_push', {}],
  ] as const) {
    assert.throws(() => gitArgs(tool, input as Record<string, unknown>), Error, `${tool} ${JSON.stringify(input)}`);
  }
});

test('Claude activity lines show the git command', () => {
  const parser = new ClaudeStreamParser('/work');
  assert.deepEqual(parser.handle({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__contextbridge__git_diff', input: { staged: true } }] } }), [
    { type: 'tool', name: 'git diff --cached', detail: '' },
  ]);
});

// Runs the real server (src/git/gitServer.ts) over stdio against a throwaway repository.
test('git MCP server answers status, diff, log and show without changing the repository', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'contextbridge-git-'));
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo });
  writeFileSync(join(repo, 'calc.py'), 'def mean(xs):\n    return sum(xs) / len(xs)\n');
  writeFileSync(join(repo, 'notes.md'), 'first\n');
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'Add calc');
  writeFileSync(join(repo, 'notes.md'), 'second\n');
  git('commit', '-qam', 'Update notes');
  writeFileSync(join(repo, 'calc.py'), 'def mean(xs):\n    if not xs:\n        return 0\n    return sum(xs) / len(xs)\n');
  writeFileSync(join(repo, 'notes.md'), 'staged\n');
  git('add', 'notes.md');
  const before = snapshot(repo);

  const server = spawn(process.execPath, [fileURLToPath(new URL('../src/git/gitServer.ts', import.meta.url)), repo], { stdio: ['pipe', 'pipe', 'inherit'] });
  const replies = new Map<number, (result: any) => void>();
  let buffer = '';
  server.stdout.on('data', (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const message = JSON.parse(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
      replies.get(message.id)?.(message);
    }
  });
  let nextId = 1;
  const call = (method: string, params: unknown = {}) => new Promise<any>((resolve) => {
    const id = nextId++;
    replies.set(id, resolve);
    server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const tool = async (name: string, args: Record<string, unknown> = {}) => (await call('tools/call', { name, arguments: args })).result;

  try {
    const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    assert.deepEqual((await call('tools/list')).result.tools.map((item: any) => item.name), ['git_status', 'git_diff', 'git_log', 'git_show']);

    assert.match((await tool('git_status')).content[0].text, /^## (main|master)\n M calc.py\nM  notes.md/);
    const unstaged = (await tool('git_diff')).content[0].text;
    assert.match(unstaged, /\+    if not xs:/);
    assert.doesNotMatch(unstaged, /notes\.md/);
    assert.match((await tool('git_diff', { staged: true })).content[0].text, /-second\n\+staged/);
    assert.match((await tool('git_diff', { base: 'HEAD~1', stat: true })).content[0].text, /calc\.py +\| 2 \+\+\n notes\.md +\| 2 \+-/);
    const log = (await tool('git_log', { maxCount: 1 })).content[0].text;
    assert.match(log, /Update notes/);
    assert.doesNotMatch(log, /Add calc/);
    assert.equal((await tool('git_show', { revision: 'HEAD~1:notes.md' })).content[0].text, 'first\n');

    const rejected = await tool('git_diff', { base: '--output=pwned.txt' });
    assert.equal(rejected.isError, true);
    const failed = await tool('git_show', { revision: 'no-such-commit' });
    assert.equal(failed.isError, true);
    assert.match(failed.content[0].text, /unknown revision|bad revision|ambiguous argument/);
  } finally {
    server.kill();
  }
  assert.equal(existsSync(join(repo, 'pwned.txt')), false);
  assert.equal(snapshot(repo), before, 'files and .git are byte-for-byte unchanged');
  rmSync(repo, { recursive: true, force: true });
});

function snapshot(root: string): string {
  const hash = createHash('sha256');
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else hash.update(`${relative(root, path)}\0`).update(readFileSync(path));
    }
  };
  walk(root);
  return hash.digest('hex');
}
