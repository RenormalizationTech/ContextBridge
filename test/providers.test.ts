import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ClaudeProvider } from '../src/providers/claudeProvider.ts';
import { ClaudeStreamParser, permissionFor } from '../src/providers/claudeStream.ts';
import { CodexProvider } from '../src/providers/codexProvider.ts';
import { CodexStreamParser } from '../src/providers/codexStream.ts';
import type { ProviderEvent } from '../src/providers/types.ts';

const delta = (text: string, parent?: string) => ({
  type: 'stream_event',
  parent_tool_use_id: parent,
  event: { type: 'content_block_delta', delta: { type: 'text_delta', text } },
});

test('permissionFor allows read tools and MCP tools, denies everything else', () => {
  assert.equal(permissionFor('Read').behavior, 'allow');
  assert.equal(permissionFor('mcp__local-searxng__search_web').behavior, 'allow');
  for (const tool of ['Edit', 'Write', 'Bash', 'NotebookEdit', 'EnterWorktree', 'CronCreate']) {
    assert.equal(permissionFor(tool).behavior, 'deny', tool);
  }
});

test('Claude parser streams main-conversation text, separates messages, and records the session', () => {
  const parser = new ClaudeStreamParser('/work');
  const events = [
    { type: 'system', subtype: 'init', session_id: 'abc' },
    { type: 'stream_event', event: { type: 'message_start' } },
    delta('Let me look.'),
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/work/src/a.py' } }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__docs__search', input: { query: 'mean' } }] } },
    delta('subagent text', 'tool_1'),
    { type: 'stream_event', event: { type: 'message_start' } },
    delta('Answer.'),
    { type: 'result', subtype: 'success', is_error: false },
  ].flatMap((event) => parser.handle(event));
  assert.deepEqual(events, [
    { type: 'text', text: 'Let me look.' },
    { type: 'tool', name: 'Read', detail: 'src/a.py' },
    { type: 'tool', name: 'docs: search', detail: 'mean' },
    { type: 'text', text: '\n\nAnswer.' },
    { type: 'done', cancelled: false },
  ]);
  assert.equal(parser.sessionId, 'abc');
  assert.equal(parser.finished, true);
});

test('Claude parser reports errors with a login hint when relevant', () => {
  const parser = new ClaudeStreamParser('/work');
  const [event] = parser.handle({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' });
  assert.equal(event.type, 'error');
  assert.match(event.type === 'error' ? event.message : '', /log in, then try again/);
});

test('Codex parser maps commands, MCP calls, messages, and failures', () => {
  const parser = new CodexStreamParser();
  const events = [
    { type: 'thread.started', thread_id: 't1' },
    { type: 'item.started', item: { type: 'command_execution', command: `/bin/zsh -lc "rg -n 'MARKER' src"` } },
    { type: 'item.started', item: { type: 'mcp_tool_call', server: 'node_repl', tool: 'js' } },
    { type: 'item.completed', item: { type: 'agent_message', text: 'First.' } },
    { type: 'item.completed', item: { type: 'reasoning', text: 'hidden' } },
    { type: 'item.completed', item: { type: 'agent_message', text: 'Second.' } },
    { type: 'turn.completed' },
  ].flatMap((event) => parser.handle(event));
  assert.deepEqual(events, [
    { type: 'tool', name: 'Shell', detail: "rg -n 'MARKER' src" },
    { type: 'tool', name: 'node_repl: js', detail: '' },
    { type: 'text', text: 'First.' },
    { type: 'text', text: '\n\nSecond.' },
    { type: 'done', cancelled: false },
  ]);
  assert.equal(parser.threadId, 't1');
  assert.deepEqual(new CodexStreamParser().handle({ type: 'turn.failed', error: { message: 'boom' } }), [{ type: 'error', message: 'boom' }]);
});

test('providers report a missing CLI from a bad configured path', async () => {
  for (const provider of [new ClaudeProvider(() => '/nonexistent/claude'), new CodexProvider(() => '/nonexistent/codex')]) {
    const events: ProviderEvent[] = [];
    await provider.ask({ prompt: 'hi', cwd: '/tmp' }, (event) => events.push(event), new AbortController().signal);
    assert.equal(events.length, 1);
    assert.match(events[0].type === 'error' ? events[0].message : '', /CLI not found/);
    assert.equal((await provider.checkStatus()).ok, false);
  }
});
