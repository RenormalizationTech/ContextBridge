import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ClaudeProvider } from '../src/providers/claudeProvider.ts';
import { askModePermission, claudeCatalog, ClaudeStreamParser, claudeModelCatalog, describeToolCall } from '../src/providers/claudeStream.ts';
import { codexCatalog } from '../src/providers/codexAppServer.ts';
import { CodexProvider } from '../src/providers/codexProvider.ts';
import { CodexAppServerParser, codexError } from '../src/providers/codexAppServerStream.ts';
import { CodexStreamParser, unwrapShell } from '../src/providers/codexStream.ts';
import type { ProviderEvent } from '../src/providers/types.ts';

const delta = (text: string, parent?: string) => ({
  type: 'stream_event',
  parent_tool_use_id: parent,
  event: { type: 'content_block_delta', delta: { type: 'text_delta', text } },
});

test('askModePermission allows read tools and MCP tools, denies everything else', () => {
  assert.equal(askModePermission('Read').behavior, 'allow');
  assert.equal(askModePermission('mcp__local-searxng__search_web').behavior, 'allow');
  for (const tool of ['Edit', 'Write', 'Bash', 'NotebookEdit', 'EnterWorktree', 'CronCreate']) {
    assert.equal(askModePermission(tool).behavior, 'deny', tool);
  }
});

test('describeToolCall summarizes commands and edits for approval cards', () => {
  assert.deepEqual(describeToolCall('Bash', { command: 'npm test', description: 'Run tests' }), { detail: 'npm test', preview: 'Run tests' });
  assert.deepEqual(describeToolCall('Edit', { file_path: '/w/a.py', old_string: 'x = 1', new_string: 'x = 2' }), {
    detail: '/w/a.py',
    preview: '- x = 1\n+ x = 2',
  });
  assert.match(describeToolCall('Write', { file_path: 'b.py', content: 'y'.repeat(2000) }).preview ?? '', /more characters/);
  assert.equal(describeToolCall('mcp__srv__tool', { q: 'x' }).preview, '{\n  "q": "x"\n}');
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
  assert.equal(unwrapShell(`/bin/zsh -lc "python3 -c \\"print('hi')\\""`), `python3 -c "print('hi')"`);
  assert.equal(unwrapShell("/bin/zsh -lc 'cat a.py'"), 'cat a.py');
  assert.deepEqual(new CodexStreamParser().handle({ type: 'turn.failed', error: { message: 'boom' } }), [{ type: 'error', message: 'boom' }]);
});

test('providers report a missing CLI from a bad configured path', async () => {
  for (const provider of [new ClaudeProvider(() => '/nonexistent/claude'), new CodexProvider(() => '/nonexistent/codex')]) {
    const events: ProviderEvent[] = [];
    await provider.ask({ prompt: 'hi', cwd: '/tmp', mode: 'ask', requestPermission: async () => false }, (event) => events.push(event), new AbortController().signal);
    assert.equal(events.length, 1);
    assert.match(events[0].type === 'error' ? events[0].message : '', /CLI not found/);
    const status = await provider.checkStatus();
    assert.equal(status.ok, false);
    assert.equal(status.installed, false);
  }
});

test('Codex app-server parser shows a web search once its query is known', () => {
  const parser = new CodexAppServerParser();
  assert.deepEqual(parser.handle('item/started', { item: { type: 'webSearch', id: 'w1', query: '' } }), []);
  assert.deepEqual(parser.handle('item/completed', { item: { type: 'webSearch', id: 'w1', query: 'rust latest release', action: { type: 'search' } } }), [
    { type: 'tool', name: 'Web search', detail: 'rust latest release' },
  ]);
});

test('Claude model list comes from the CLI help, with fallbacks', () => {
  const help = `  --fallback-model <model>  Enable automatic fallback to specified
                            model(s) when the default model is overloaded
  --model <model>           Model for the current session. Provide
                            an alias for the latest model (e.g.
                            'nova', 'opus', or 'sonnet') or a
                            model's full name.
  -n, --name <name>         Set a display name
  --effort <level>          Effort level for the current session
                            (low, medium, high)`;
  const catalog = claudeModelCatalog(help);
  assert.deepEqual(catalog.models.map((model) => model.id), ['nova', 'opus', 'sonnet', 'fable', 'haiku']);
  assert.equal(catalog.models[0].label, 'Nova (latest)');
  assert.deepEqual(catalog.efforts, ['low', 'medium', 'high']);
  assert.deepEqual(catalog.models[0].efforts, ['low', 'medium', 'high']);

  const fallback = claudeModelCatalog(undefined);
  assert.deepEqual(fallback.models.map((model) => model.id), ['fable', 'opus', 'sonnet', 'haiku']);
  assert.deepEqual(fallback.efforts, ['low', 'medium', 'high', 'xhigh', 'max']);
});

test('Claude parser reports the resolved model from the init event', () => {
  const parser = new ClaudeStreamParser('/work');
  assert.deepEqual(parser.handle({ type: 'system', subtype: 'init', model: 'claude-opus-5-5', session_id: 's' }), [{ type: 'model', model: 'claude-opus-5-5' }]);
  assert.deepEqual(parser.handle({ type: 'system', subtype: 'status' }), []);
});

test('Codex errors unwrap API JSON and flag unavailable models only', () => {
  assert.deepEqual(codexError('{"type":"error","status":400,"error":{"message":"The \'x\' model is not supported when using Codex with a ChatGPT account."}}'), {
    type: 'error',
    message: "The 'x' model is not supported when using Codex with a ChatGPT account.",
    modelUnavailable: true,
  });
  assert.deepEqual(codexError('stream disconnected before completion'), { type: 'error', message: 'stream disconnected before completion' });
  assert.deepEqual(codexError('{"error":{"message":"Rate limit reached"}}'), { type: 'error', message: 'Rate limit reached' });
});

test('Claude catalog: Default follows the applied model (user settings), else the default entry', () => {
  const init = { models: [
    { value: 'default', resolvedModel: 'claude-a-1', displayName: 'Default (recommended)', supportedEffortLevels: ['low', 'high'] },
    { value: 'a', resolvedModel: 'claude-a-1', displayName: 'A 1', supportedEffortLevels: ['low', 'high'] },
    { value: 'b', resolvedModel: 'claude-b-2', displayName: 'B 2', supportedEffortLevels: ['low'] },
  ] };
  assert.deepEqual(claudeCatalog(init, { applied: { model: 'claude-b-2', effort: 'low' } })?.defaultModel, { label: 'B 2', efforts: ['low'], effort: 'low' });
  assert.deepEqual(claudeCatalog(init, undefined)?.defaultModel, { label: 'A 1', efforts: ['low', 'high'], effort: undefined });
  assert.deepEqual(claudeCatalog(init, { applied: { model: 'claude-x-0', effort: null } })?.defaultModel, { label: 'claude-x-0', efforts: ['low', 'high'], effort: undefined });
  assert.equal(claudeCatalog({ models: [] }, undefined), undefined);
});

test('Codex catalog: configured effort only where the model supports it', () => {
  const efforts = (list: string[]) => list.map((reasoningEffort) => ({ reasoningEffort }));
  const models = [
    { model: 'm1', displayName: 'M1', isDefault: true, hidden: false, defaultReasoningEffort: 'medium', supportedReasoningEfforts: efforts(['low', 'medium', 'ultra']) },
    { model: 'm2', displayName: 'M2', isDefault: false, hidden: false, defaultReasoningEffort: 'low', supportedReasoningEfforts: efforts(['low', 'medium']) },
  ];
  const catalog = codexCatalog(models, { model: 'custom-x', model_reasoning_effort: 'ultra' });
  assert.deepEqual(catalog.models.map((model) => model.defaultEffort), ['ultra', 'low']);
  assert.deepEqual(catalog.defaultModel, { label: 'custom-x', efforts: [], effort: 'ultra' });
  assert.deepEqual(codexCatalog(models, {}).defaultModel, { label: 'M1', efforts: ['low', 'medium', 'ultra'], effort: 'medium' });
});
