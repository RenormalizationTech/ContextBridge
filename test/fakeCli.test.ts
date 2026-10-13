// Runs the real provider adapters against fake `claude` / `codex` executables that speak the same
// JSON streams, to check flags, the permission protocol, follow-ups, cancellation and errors offline.
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { ClaudeProvider } from '../src/providers/claudeProvider.ts';
import { CodexProvider } from '../src/providers/codexProvider.ts';
import type { Mode, PermissionRequest, Provider, ProviderEvent } from '../src/providers/types.ts';

const dir = mkdtempSync(join(tmpdir(), 'contextbridge-fake-'));
const logFile = join(dir, 'log.jsonl');
const savedEnv = { FAKE_MODE: process.env.FAKE_MODE, FAKE_LOG: process.env.FAKE_LOG };
process.env.FAKE_LOG = logFile;
after(() => {
  Object.assign(process.env, savedEnv);
  rmSync(dir, { recursive: true, force: true });
});

function writeFake(name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, `#!${process.execPath}
const fs = require('node:fs');
const log = (entry) => fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(entry) + '\\n');
const out = (event) => process.stdout.write(JSON.stringify(event) + '\\n');
const mode = process.env.FAKE_MODE || 'normal';
log({ args: process.argv.slice(2), pid: process.pid });
${body}`);
  chmodSync(path, 0o755);
  return path;
}

const claudePath = writeFake('claude', `
if (mode === 'crash') { process.stderr.write('boom: something broke'); process.exit(1); }
const pending = new Map();
let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf('\\n')) >= 0) {
    const message = JSON.parse(buffer.slice(0, i));
    buffer = buffer.slice(i + 1);
    if (message.type === 'control_response') {
      log({ permission: message.response.request_id, response: message.response.response });
      pending.get(message.response.request_id)?.();
    } else if (message.type === 'control_request') control(message);
    else if (message.type === 'user') run(message);
  }
});
const ask = (id, tool_name, input) => new Promise((resolve) => {
  pending.set(id, resolve);
  out({ type: 'control_request', request_id: id, request: { subtype: 'can_use_tool', tool_name, input } });
});
// Control questions ContextBridge asks before (or instead of) a message.
function control(message) {
  const args = process.argv.slice(2);
  const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const reply = (response) => out({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response } });
  const subtype = message.request.subtype;
  if (mode === 'nosettings' || (subtype !== 'get_settings' && subtype !== 'initialize')) {
    out({ type: 'control_response', response: { subtype: 'error', request_id: message.request_id, error: 'Unsupported control request subtype: ' + subtype } });
  } else if (subtype === 'get_settings') {
    const model = flag('--model');
    reply({ applied: { model: model ? 'resolved-' + model : 'claude-big-9', effort: model === 'old' ? null : flag('--effort') ?? (model === 'opus' ? 'high' : 'medium') } });
  } else {
    reply({ models: [
      { value: 'default', resolvedModel: 'claude-big-9', displayName: 'Default (recommended)', supportedEffortLevels: ['low', 'medium', 'high', 'max'] },
      { value: 'opus', resolvedModel: 'resolved-opus', displayName: 'Opus 9', supportedEffortLevels: ['low', 'medium', 'high', 'max'] },
      { value: 'big', resolvedModel: 'claude-big-9', displayName: 'Big 9', supportedEffortLevels: ['low', 'medium', 'high', 'max'] },
      { value: 'old', resolvedModel: 'claude-old-1', displayName: 'Old 1' },
    ] });
  }
}
const delta = (text) => out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
async function run(message) {
  log({ prompt: message.message.content });
  const args = process.argv.slice(2);
  const model = args.includes('--model') ? 'resolved-' + args[args.indexOf('--model') + 1] : undefined;
  out({ type: 'system', subtype: 'init', session_id: 'session-1', model });
  if (mode === 'badmodel') {
    out({ type: 'assistant', error: 'model_not_found', message: { content: [{ type: 'text', text: 'There is an issue with the selected model.' }] } });
    out({ type: 'result', subtype: 'success', is_error: true, result: 'There is an issue with the selected model.', session_id: 'session-1' });
    return;
  }
  if (mode === 'slow') { setInterval(() => delta('more '), 20); return; }
  if (mode === 'waiting') { out({ type: 'control_request', request_id: 'w1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'rm -rf build' } } }); return; }
  await ask('p1', 'Edit', { file_path: 'a.py', old_string: 'a', new_string: 'b' });
  await ask('p2', 'mcp__srv__tool', { q: 'x' });
  delta('Hello ');
  delta('world');
  out({ type: 'result', subtype: 'success', is_error: false, session_id: 'session-1' });
}
`);

// Fake `codex app-server`: JSON-RPC over stdio, like the real one.
const appServerPath = writeFake('codex-app-server', `
let buffer = '';
let thread = 0;
const waiting = new Map();
const send = (message) => out(message);
const ask = (id, method, params) => new Promise((resolve) => { waiting.set(id, resolve); send({ id, method, params }); });
process.stdin.on('data', async (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf('\\n')) >= 0) {
    const message = JSON.parse(buffer.slice(0, i));
    buffer = buffer.slice(i + 1);
    if (message.method === undefined) { log({ approvalAnswer: message }); waiting.get(message.id)?.(message); continue; }
    log({ method: message.method, params: message.params });
    if (message.method === 'initialize') send({ id: message.id, result: { userAgent: 'fake' } });
    if (message.method === 'thread/start') send({ id: message.id, result: { thread: { id: 'thread-' + (++thread) }, model: message.params.model, reasoningEffort: 'medium' } });
    if (message.method === 'thread/resume') send({ id: message.id, result: { thread: { id: message.params.threadId }, model: message.params.model, reasoningEffort: 'medium' } });
    if (message.method === 'config/read') send({ id: message.id, result: { config: mode === 'config' ? { model: 'fast-1', model_reasoning_effort: 'medium' } : { model: null, model_reasoning_effort: null } } });
    if (message.method === 'model/list') {
      const efforts = (list) => list.map((reasoningEffort) => ({ reasoningEffort, description: '' }));
      if (!message.params.cursor) send({ id: message.id, result: { nextCursor: 'page-2', data: [
        { id: 'fast-1', model: 'fast-1', displayName: 'Fast 1', hidden: false, isDefault: false, defaultReasoningEffort: 'low', supportedReasoningEfforts: efforts(['low', 'medium']) },
        { id: 'secret', model: 'secret', displayName: 'Secret', hidden: true, isDefault: false, defaultReasoningEffort: 'low', supportedReasoningEfforts: [] },
      ] } });
      else send({ id: message.id, result: { nextCursor: null, data: [
        { id: 'big-2', model: 'big-2', displayName: 'Big 2', hidden: false, isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: efforts(['low', 'medium', 'high']) },
      ] } });
    }
    if (message.method === 'turn/interrupt') send({ id: message.id, result: {} });
    if (message.method === 'turn/start') {
      const threadId = message.params.threadId;
      send({ id: message.id, result: { turn: { id: 'turn-1' } } });
      send({ method: 'turn/started', params: { threadId, turn: { id: 'turn-1' } } });
      if (mode === 'badmodel') {
        const error = { message: JSON.stringify({ type: 'error', status: 400, error: { message: "The 'old-1' model is not supported when using Codex with a ChatGPT account." } }) };
        send({ method: 'turn/completed', params: { threadId, turn: { id: 'turn-1', status: 'failed', error } } });
        continue;
      }
      send({ method: 'item/started', params: { item: { type: 'commandExecution', id: 'c1', command: "/bin/zsh -lc 'cat a.py'" } } });
      if (mode === 'slow') { setInterval(() => send({ method: 'item/agentMessage/delta', params: { itemId: 'm1', delta: 'more ' } }), 20); continue; }
      const approval = await ask('srv-1', 'item/commandExecution/requestApproval', { itemId: 'c2', command: "/bin/zsh -lc 'python3 fix.py'", reason: 'needs write access' });
      send({ method: 'item/agentMessage/delta', params: { itemId: 'm1', delta: 'Streamed ' } });
      send({ method: 'item/agentMessage/delta', params: { itemId: 'm1', delta: approval.result.decision } });
      send({ method: 'turn/completed', params: { threadId, turn: { id: 'turn-1', status: 'completed', error: null } } });
    }
  }
});
`);

const codexPath = writeFake('codex', `
let prompt = '';
process.stdin.on('data', (chunk) => (prompt += chunk));
process.stdin.on('end', () => {
  log({ prompt });
  out({ type: 'thread.started', thread_id: 'thread-1' });
  if (mode === 'slow') { setInterval(() => out({ type: 'item.started', item: { type: 'command_execution', command: 'ls' } }), 20); return; }
  out({ type: 'item.completed', item: { type: 'agent_message', text: 'Codex answer' } });
  out({ type: 'turn.completed' });
});
`);

function readLog(): any[] {
  try {
    return readFileSync(logFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

interface AskOptions {
  abortAfterEvents?: number;
  abortAfterMs?: number;
  mode?: Mode;
  model?: string;
  effort?: string;
  requestPermission?: (request: PermissionRequest) => Promise<boolean>;
}

async function ask(provider: Provider, options: AskOptions = {}): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = [];
  const controller = new AbortController();
  if (options.abortAfterMs) setTimeout(() => controller.abort(), options.abortAfterMs);
  const request = {
    prompt: 'What does a.py do?',
    cwd: dir,
    mode: options.mode ?? 'ask',
    model: options.model,
    effort: options.effort,
    requestPermission: options.requestPermission ?? (async () => assert.fail('Ask mode must not ask the user')),
  };
  await provider.ask(request, (event) => {
    events.push(event);
    if (events.length === options.abortAfterEvents) controller.abort();
  }, controller.signal);
  return events;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('Claude adapter: read-only tools, permission answers, streaming, and resumed follow-ups', async () => {
  writeFileSync(logFile, '');
  process.env.FAKE_MODE = 'normal';
  const provider = new ClaudeProvider(() => claudePath);

  assert.deepEqual(await ask(provider), [
    { type: 'model', model: 'claude-big-9', effort: 'medium', effortConfirmed: true },
    { type: 'text', text: 'Hello ' },
    { type: 'text', text: 'world' },
    { type: 'done', cancelled: false },
  ]);
  const log = readLog();
  const args: string[] = log[0].args;
  const tools = args[args.indexOf('--tools') + 1].split(',');
  for (const tool of ['Edit', 'Write', 'Bash', 'NotebookEdit']) assert.ok(!tools.includes(tool), `${tool} must not exist`);
  assert.equal(args[args.indexOf('--permission-prompt-tool') + 1], 'stdio');
  assert.ok(!args.includes('--resume'));
  assert.equal(log[1].prompt, 'What does a.py do?');
  assert.equal(log.find((entry) => entry.permission === 'p1').response.behavior, 'deny');
  assert.deepEqual(log.find((entry) => entry.permission === 'p2').response, { behavior: 'allow', updatedInput: { q: 'x' } });

  writeFileSync(logFile, '');
  await ask(provider);
  const followUp: string[] = readLog()[0].args;
  assert.equal(followUp[followUp.indexOf('--resume') + 1], 'session-1');

  provider.resetConversation();
  writeFileSync(logFile, '');
  await ask(provider);
  assert.ok(!readLog()[0].args.includes('--resume'));
});

test('Codex adapter: read-only sandbox on the first question and on resume', async () => {
  writeFileSync(logFile, '');
  process.env.FAKE_MODE = 'normal';
  const provider = new CodexProvider(() => codexPath, () => 'exec');

  assert.deepEqual(await ask(provider), [
    { type: 'text', text: 'Codex answer' },
    { type: 'done', cancelled: false },
  ]);
  await ask(provider);
  const [first, , second] = readLog();
  for (const { args } of [first, second]) {
    assert.equal(args[args.indexOf('-c') + 1], 'sandbox_mode="read-only"');
    assert.ok(!args.some((arg: string) => /danger|workspace-write|bypass/.test(arg)));
  }
  assert.equal(first.args[first.args.indexOf('--sandbox') + 1], 'read-only');
  for (const { args } of [first, second]) assert.ok(args.includes('web_search="live"'), 'exec also enables web search');
  assert.deepEqual(second.args.slice(0, 2), ['exec', 'resume']);
  assert.ok(second.args.includes('thread-1'));
});

test('cancelling stops the stream and terminates the provider process', async () => {
  process.env.FAKE_MODE = 'slow';
  for (const provider of [new ClaudeProvider(() => claudePath), new CodexProvider(() => codexPath, () => 'exec')]) {
    writeFileSync(logFile, '');
    const events = await ask(provider, { abortAfterEvents: 3 });
    assert.deepEqual(events.at(-1), { type: 'done', cancelled: true }, provider.label);
    assert.equal(events.filter((event) => event.type === 'done' || event.type === 'error').length, 1);
    assert.equal(isAlive(readLog()[0].pid), false, `${provider.label} process should be gone`);
  }
});

test('a provider that exits early reports its error output', async () => {
  writeFileSync(logFile, '');
  process.env.FAKE_MODE = 'crash';
  const events = await ask(new ClaudeProvider(() => claudePath));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'error');
  assert.match(events[0].type === 'error' ? events[0].message : '', /exited before answering: boom: something broke/);
});

test('Claude adapter in Agent mode: full tool set and permission prompts answered by the user', async () => {
  writeFileSync(logFile, '');
  process.env.FAKE_MODE = 'normal';
  const asked: PermissionRequest[] = [];
  const events = await ask(new ClaudeProvider(() => claudePath), {
    mode: 'agent',
    requestPermission: async (request) => {
      asked.push(request);
      return request.tool === 'Edit';
    },
  });
  assert.deepEqual(events.at(-1), { type: 'done', cancelled: false });
  const log = readLog();
  assert.ok(!log[0].args.includes('--tools'), 'Agent mode keeps the default tool set');
  assert.equal(log[0].args[log[0].args.indexOf('--permission-prompt-tool') + 1], 'stdio');
  assert.deepEqual(asked, [
    { tool: 'Edit', detail: 'a.py', preview: '- a\n+ b', always: { key: 'edits', label: 'Allow all file edits for the rest of this chat' } },
    { tool: 'mcp__srv__tool', detail: '', preview: '{\n  "q": "x"\n}', always: { key: 'tool:mcp__srv__tool', label: 'Allow mcp__srv__tool for the rest of this chat' } },
  ]);
  assert.equal(log.find((entry) => entry.permission === 'p1').response.behavior, 'allow');
  assert.deepEqual(log.find((entry) => entry.permission === 'p2').response, { behavior: 'deny', message: 'The user denied this action.' });
});

test('cancelling while an approval is pending ends the request and the process', async () => {
  writeFileSync(logFile, '');
  process.env.FAKE_MODE = 'waiting';
  let asked = false;
  const events = await ask(new ClaudeProvider(() => claudePath), {
    mode: 'agent',
    abortAfterMs: 300,
    requestPermission: () => {
      asked = true;
      return new Promise(() => {});
    },
  });
  assert.equal(asked, true);
  assert.deepEqual(events.filter((event) => event.type !== 'model'), [{ type: 'done', cancelled: true }]);
  assert.equal(isAlive(readLog()[0].pid), false);
});

test('Codex adapter in Agent mode uses the workspace-write sandbox, also on resume', async () => {
  writeFileSync(logFile, '');
  process.env.FAKE_MODE = 'normal';
  const provider = new CodexProvider(() => codexPath, () => 'exec');
  await ask(provider, { mode: 'agent' });
  await ask(provider, { mode: 'agent' });
  const [first, , second] = readLog();
  assert.equal(first.args[first.args.indexOf('--sandbox') + 1], 'workspace-write');
  for (const { args } of [first, second]) assert.equal(args[args.indexOf('-c') + 1], 'sandbox_mode="workspace-write"');
  assert.deepEqual(second.args.slice(0, 2), ['exec', 'resume']);
});

test('Codex app-server: read-only thread settings, streamed text, resume, and Ask-mode approvals declined', async () => {
  writeFileSync(logFile, '');
  process.env.FAKE_MODE = 'normal';
  const provider = new CodexProvider(() => appServerPath);
  assert.equal(provider.streamsTokens, true);

  const events = await ask(provider);
  assert.deepEqual(events, [
    { type: 'tool', name: 'Shell', detail: 'cat a.py' },
    { type: 'text', text: 'Streamed ' },
    { type: 'text', text: 'decline' },
    { type: 'done', cancelled: false },
  ]);
  await ask(provider);
  const log = readLog();
  assert.deepEqual(log[0].args, ['app-server', '--stdio']);
  const start = log.find((entry) => entry.method === 'thread/start');
  assert.deepEqual({ sandbox: start.params.sandbox, approvalPolicy: start.params.approvalPolicy }, { sandbox: 'read-only', approvalPolicy: 'never' });
  assert.deepEqual(start.params.config, { web_search: 'live' });
  const resume = log.find((entry) => entry.method === 'thread/resume');
  assert.deepEqual({ threadId: resume.params.threadId, sandbox: resume.params.sandbox, approvalPolicy: resume.params.approvalPolicy }, { threadId: 'thread-1', sandbox: 'read-only', approvalPolicy: 'never' });
  assert.deepEqual(resume.params.config, { web_search: 'live' });
  assert.equal(log.find((entry) => entry.method === 'turn/start').params.input[0].text, 'What does a.py do?');
});

test('Codex app-server in Agent mode: approvals go to the user', async () => {
  writeFileSync(logFile, '');
  process.env.FAKE_MODE = 'normal';
  const asked: PermissionRequest[] = [];
  const events = await ask(new CodexProvider(() => appServerPath), {
    mode: 'agent',
    requestPermission: async (request) => {
      asked.push(request);
      return true;
    },
  });
  assert.deepEqual(asked, [{ tool: 'Shell command', detail: 'python3 fix.py', preview: 'needs write access', always: { key: 'command:python3 fix.py', label: 'Allow this exact command for the rest of this chat' } }]);
  assert.equal(events.filter((event) => event.type === 'text').map((event) => (event.type === 'text' ? event.text : '')).join(''), 'Streamed accept');
  const start = readLog().find((entry) => entry.method === 'thread/start');
  assert.deepEqual({ sandbox: start.params.sandbox, approvalPolicy: start.params.approvalPolicy }, { sandbox: 'read-only', approvalPolicy: 'on-request' });
});

test('Codex app-server: cancelling interrupts the turn and stops the server', async () => {
  writeFileSync(logFile, '');
  process.env.FAKE_MODE = 'slow';
  const events = await ask(new CodexProvider(() => appServerPath), { abortAfterEvents: 3 });
  assert.deepEqual(events.at(-1), { type: 'done', cancelled: true });
  const log = readLog();
  assert.ok(log.some((entry) => entry.method === 'turn/interrupt'), 'sends turn/interrupt');
  assert.equal(isAlive(log[0].pid), false);
});

test('Claude adapter: chosen model and effort are passed on each question, also on resume', async () => {
  writeFileSync(logFile, '');
  process.env.FAKE_MODE = 'normal';
  const provider = new ClaudeProvider(() => claudePath);
  const events = await ask(provider, { model: 'opus', effort: 'high' });
  assert.deepEqual(events[0], { type: 'model', model: 'resolved-opus', effort: 'high', effortConfirmed: true }, 'from get_settings');
  await ask(provider, { model: 'sonnet' });
  const [first, second] = readLog().filter((entry) => entry.args);
  assert.deepEqual(first.args.slice(first.args.indexOf('--model'), first.args.indexOf('--model') + 4), ['--model', 'opus', '--effort', 'high']);
  assert.equal(second.args[second.args.indexOf('--model') + 1], 'sonnet');
  assert.ok(second.args.includes('--resume'), 'switching models keeps the conversation');
  assert.ok(!second.args.includes('--effort'));

  // No choice: no flags, so the user's Claude settings decide.
  provider.resetConversation();
  writeFileSync(logFile, '');
  const plain = await ask(provider);
  assert.deepEqual(plain[0], { type: 'model', model: 'claude-big-9', effort: 'medium', effortConfirmed: true }, 'the CLI default is reported too');
  assert.ok(!readLog()[0].args.some((arg: string) => arg === '--model' || arg === '--effort'));
});

test('Claude adapter flags a model the CLI rejects', async () => {
  writeFileSync(logFile, '');
  process.env.FAKE_MODE = 'badmodel';
  const events = await ask(new ClaudeProvider(() => claudePath), { model: 'claude-retired-1' });
  assert.deepEqual(events.at(-1), { type: 'error', message: 'There is an issue with the selected model.', modelUnavailable: true });
});

test('Codex app-server: model list with pages, and model and effort on thread and turn', async () => {
  process.env.FAKE_MODE = 'normal';
  const provider = new CodexProvider(() => appServerPath);
  assert.deepEqual(await provider.listModels(dir), {
    models: [
      { id: 'fast-1', label: 'Fast 1', efforts: ['low', 'medium'], defaultEffort: 'low' },
      { id: 'big-2', label: 'Big 2', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
    ],
    efforts: ['low', 'medium', 'high'],
    defaultModel: { label: 'Big 2', efforts: ['low', 'medium', 'high'], effort: 'medium' },
  });
  const configRead = readLog().find((entry) => entry.method === 'config/read');
  assert.equal(configRead.params.cwd, dir, 'project config is read for the workspace');

  // The user's Codex config decides what Default means; its effort applies to any model that supports it.
  process.env.FAKE_MODE = 'config';
  const configured = await provider.listModels(dir);
  assert.deepEqual(configured?.defaultModel, { label: 'Fast 1', efforts: ['low', 'medium'], effort: 'medium' });
  assert.deepEqual(configured?.models.map((model) => model.defaultEffort), ['medium', 'medium']);
  process.env.FAKE_MODE = 'normal';

  writeFileSync(logFile, '');
  const events = await ask(provider, { model: 'fast-1', effort: 'low' });
  assert.deepEqual(events[0], { type: 'model', model: 'fast-1', effort: 'low' });
  await ask(provider, { model: 'big-2' });
  const log = readLog();
  assert.equal(log.find((entry) => entry.method === 'thread/start').params.model, 'fast-1');
  const turns = log.filter((entry) => entry.method === 'turn/start');
  assert.deepEqual([turns[0].params.model, turns[0].params.effort], ['fast-1', 'low']);
  assert.equal(log.find((entry) => entry.method === 'thread/resume').params.model, 'big-2');
  assert.deepEqual([turns[1].params.model, 'effort' in turns[1].params], ['big-2', false]);

  // No choice: nothing is sent, so the user's Codex config decides.
  provider.resetConversation();
  writeFileSync(logFile, '');
  await ask(provider);
  const plain = readLog();
  assert.ok(!('model' in plain.find((entry) => entry.method === 'thread/start').params));
  assert.ok(!('effort' in plain.find((entry) => entry.method === 'turn/start').params));
});

test('Codex app-server: an unsupported model is reported readably and flagged', async () => {
  writeFileSync(logFile, '');
  process.env.FAKE_MODE = 'badmodel';
  const events = await ask(new CodexProvider(() => appServerPath), { model: 'old-1' });
  assert.deepEqual(events.at(-1), { type: 'error', message: "The 'old-1' model is not supported when using Codex with a ChatGPT account.", modelUnavailable: true });
});

test('Codex exec: model and effort flags, also on resume', async () => {
  writeFileSync(logFile, '');
  process.env.FAKE_MODE = 'normal';
  const provider = new CodexProvider(() => codexPath, () => 'exec');
  const events = await ask(provider, { model: 'fast-1', effort: 'low' });
  assert.deepEqual(events[0], { type: 'model', model: 'fast-1', effort: 'low' });
  await ask(provider, { model: 'fast-1', effort: 'low' });
  const [first, , second] = readLog();
  for (const { args } of [first, second]) {
    assert.equal(args[args.indexOf('-m') + 1], 'fast-1');
    assert.ok(args.includes('model_reasoning_effort="low"'));
  }
  assert.deepEqual(second.args.slice(0, 2), ['exec', 'resume']);
});

test('Claude adapter: model list and defaults from control requests, without a message', async () => {
  writeFileSync(logFile, '');
  process.env.FAKE_MODE = 'normal';
  const provider = new ClaudeProvider(() => claudePath);
  assert.deepEqual(await provider.listModels(dir), {
    models: [
      { id: 'opus', label: 'Opus 9', efforts: ['low', 'medium', 'high', 'max'], resolvesTo: 'resolved-opus' },
      { id: 'big', label: 'Big 9', efforts: ['low', 'medium', 'high', 'max'], resolvesTo: 'claude-big-9' },
      { id: 'old', label: 'Old 1', efforts: [], resolvesTo: 'claude-old-1' },
    ],
    efforts: ['low', 'medium', 'high', 'max'],
    defaultModel: { label: 'Big 9', efforts: ['low', 'medium', 'high', 'max'], effort: 'medium' },
  });
  assert.equal(await provider.defaultEffort('opus', dir), 'high');
  assert.equal(await provider.defaultEffort('old', dir), undefined);
  assert.ok(!readLog().some((entry) => entry.prompt), 'no question was sent');

  // A CLI that can't answer them: no model list, so the pickers stay hidden.
  process.env.FAKE_MODE = 'nosettings';
  assert.equal(await provider.listModels(dir), undefined);
});

test('Claude adapter: without get_settings, the footer gets the init model and the requested effort', async () => {
  writeFileSync(logFile, '');
  process.env.FAKE_MODE = 'nosettings';
  const events = await ask(new ClaudeProvider(() => claudePath), { model: 'opus', effort: 'max' });
  assert.deepEqual(events.filter((event) => event.type === 'model'), [{ type: 'model', model: 'resolved-opus', effort: 'max' }]);
  assert.deepEqual(events.at(-1), { type: 'done', cancelled: false });
});

test('Claude adapter: Ask mode adds the read-only Git MCP server; Agent mode does not', async () => {
  process.env.FAKE_MODE = 'normal';
  const provider = new ClaudeProvider(() => claudePath, '/ext/dist/git-mcp.cjs');
  writeFileSync(logFile, '');
  await ask(provider);
  const args: string[] = readLog()[0].args;
  const config = JSON.parse(args[args.indexOf('--mcp-config') + 1]);
  assert.deepEqual(config.mcpServers.contextbridge, { type: 'stdio', command: process.execPath, args: ['/ext/dist/git-mcp.cjs', dir], env: { ELECTRON_RUN_AS_NODE: '1' } });
  assert.ok(!args.includes('--strict-mcp-config'), "the user's own MCP servers stay available");
  assert.ok(!args[args.indexOf('--tools') + 1].split(',').includes('Bash'), 'still no shell');

  provider.resetConversation();
  writeFileSync(logFile, '');
  await ask(provider, { mode: 'agent', requestPermission: async () => true });
  assert.ok(!readLog()[0].args.includes('--mcp-config'));
});
