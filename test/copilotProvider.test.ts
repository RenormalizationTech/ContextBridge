import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CopilotClient, ModelInfo, SessionConfig } from '@github/copilot-sdk';
import { COPILOT_ASK_TOOLS, CopilotProvider, copilotModels, copilotPermission } from '../src/providers/copilotProvider.ts';
import type { ProviderEvent, ProviderRequest } from '../src/providers/types.ts';

function fakeClient() {
  let listener: (event: any) => void = () => {};
  let config: SessionConfig;
  let stopped = 0, aborted = 0;
  let reply: () => Promise<any> = async () => {
    listener({ type: 'assistant.message_delta', data: { messageId: 'a', deltaContent: 'Hello ' } });
    listener({ type: 'assistant.message_delta', agentId: 'child', data: { messageId: 'child', deltaContent: 'private' } });
    listener({ type: 'assistant.message_delta', data: { messageId: 'a', deltaContent: 'world' } });
    listener({ type: 'assistant.message', data: { messageId: 'a', content: 'Hello world' } });
    listener({ type: 'tool.execution_start', data: { toolName: 'git_diff', arguments: { staged: true } } });
    return { data: { messageId: 'a', content: 'Hello world' } };
  };
  const session = {
    sessionId: 'saved-session', on: (handler: typeof listener) => { listener = handler; return () => { listener = () => {}; }; },
    sendAndWait: () => reply(), abort: async () => { aborted++; },
    rpc: { model: { getCurrent: async () => ({ modelId: config.model ?? 'configured-model', reasoningEffort: config.reasoningEffort }) } },
  };
  const starts: { id?: string; config: SessionConfig }[] = [];
  const fake = {
    start: async () => {}, stop: async () => { stopped++; return []; }, forceStop: async () => { stopped++; },
    createSession: async (options: SessionConfig) => { config = options; starts.push({ config }); return session; },
    resumeSession: async (id: string, options: SessionConfig) => { config = options; starts.push({ id, config }); return session; },
    getAuthStatus: async () => ({ isAuthenticated: true }), listModels: async () => [],
  };
  const client = fake as unknown as CopilotClient;
  return { fake, client, starts, get config() { return config; }, get stopped() { return stopped; }, get aborted() { return aborted; }, set reply(value: typeof reply) { reply = value; } };
}
const request = (overrides: Partial<ProviderRequest> = {}): ProviderRequest => ({
  cwd: process.cwd(), prompt: 'Question', mode: 'ask', requestPermission: async () => false, ...overrides,
});

test('Copilot streams without duplicate full messages or subagent text, resumes with fresh Ask filters, and resets history', async () => {
  const stub = fakeClient();
  const provider = new CopilotProvider(() => process.execPath, () => stub.client);
  const events: ProviderEvent[] = [];
  await provider.ask(request({ model: 'mini', effort: 'high' }), event => events.push(event), new AbortController().signal);
  assert.equal(events.filter(e => e.type === 'text').map(e => e.text).join(''), 'Hello world');
  assert.deepEqual(events.find(e => e.type === 'tool'), { type: 'tool', name: 'git diff --cached', detail: '' });
  assert.ok(events.some(e => e.type === 'model' && e.model === 'mini' && e.effort === 'high'));
  assert.deepEqual(stub.config.availableTools, COPILOT_ASK_TOOLS);
  assert.ok(stub.config.tools?.some(tool => tool.name === 'git_diff'));
  assert.equal(stub.config.enableConfigDiscovery, true);
  assert.equal(provider.conversationId, 'saved-session');
  await provider.ask(request({ mode: 'agent' }), () => {}, new AbortController().signal);
  assert.equal(stub.starts[1].id, 'saved-session');
  assert.equal(stub.config.availableTools, undefined);
  await provider.ask(request(), () => {}, new AbortController().signal);
  assert.deepEqual(stub.config.availableTools, COPILOT_ASK_TOOLS);
  provider.resetConversation(); assert.equal(provider.conversationId, undefined);
  provider.restoreConversation('other'); assert.equal(provider.conversationId, 'other');
  assert.equal(stub.stopped, 3);
});

test('Copilot Ask denies shell/write requests; Agent routes edit approvals with diff previews', async () => {
  const stub = fakeClient();
  const provider = new CopilotProvider(() => process.execPath, () => stub.client);
  const shell: any = { kind: 'shell', fullCommandText: 'git commit -am test', intention: 'Commit' };
  const write: any = { kind: 'write', fileName: 'a.txt', diff: '-before\n+after', intention: 'Edit' };
  let cards = 0;
  stub.reply = async () => {
    const permission = stub.config.onPermissionRequest!;
    assert.equal((await permission(shell, { sessionId: 'saved-session' })).kind, 'reject');
    assert.equal((await permission(write, { sessionId: 'saved-session' })).kind, 'reject');
    assert.equal((await permission({ kind: 'read', path: 'a.txt' } as any, { sessionId: 'saved-session' })).kind, 'approve-once');
    return { data: { messageId: 'answer', content: 'Denied' } };
  };
  await provider.ask(request({ requestPermission: async () => { cards++; return true; } }), () => {}, new AbortController().signal);
  assert.equal(cards, 0);
  stub.reply = async () => {
    const result = await stub.config.onPermissionRequest!(write, { sessionId: 'saved-session' });
    assert.equal(result.kind, 'approve-once');
    return { data: { messageId: 'answer', content: 'Edited' } };
  };
  await provider.ask(request({ mode: 'agent', requestPermission: async card => {
    cards++; assert.equal(card.preview, '-before\n+after'); assert.equal(card.always?.key, 'edits'); return true;
  } }), () => {}, new AbortController().signal);
  assert.equal(cards, 1);
  const managed = copilotPermission({ ...write, managedApprovalRequired: true });
  assert.equal(managed.requireUser, true); assert.equal(managed.always, undefined);
});

test('Copilot cancellation stops the runtime and emits only one terminal event', async () => {
  const stub = fakeClient(); const controller = new AbortController();
  const provider = new CopilotProvider(() => process.execPath, () => stub.client);
  const events: ProviderEvent[] = [];
  stub.reply = async () => { controller.abort(); throw new Error('connection closed'); };
  await provider.ask(request(), event => events.push(event), controller.signal);
  assert.deepEqual(events.filter(e => e.type === 'done' || e.type === 'error'), [{ type: 'done', cancelled: true }]);
  assert.ok(stub.stopped > 0); assert.ok(stub.aborted > 0);
});

test('Copilot reports missing CLI/session, unavailable models and empty turns clearly', async () => {
  const missing = new CopilotProvider(() => '/nonexistent/contextbridge-copilot');
  assert.equal((await missing.checkStatus()).installed, false);
  const stub = fakeClient(); const provider = new CopilotProvider(() => process.execPath, () => stub.client);
  provider.restoreConversation('missing');
  stub.fake.resumeSession = async () => { throw new Error('Session does not exist'); };
  const events: ProviderEvent[] = [];
  await provider.ask(request(), event => events.push(event), new AbortController().signal);
  assert.equal(provider.conversationId, undefined); assert.equal(events.at(-1)?.type, 'error');
  stub.reply = async () => { throw new Error('model mini is not supported'); };
  await provider.ask(request({ model: 'mini' }), event => events.push(event), new AbortController().signal);
  assert.ok(events.some(event => event.type === 'error' && event.modelUnavailable));
  stub.reply = async () => undefined;
  await provider.ask(request(), event => events.push(event), new AbortController().signal);
  assert.ok(events.at(-1)?.type === 'error');
});

test('Copilot model catalog uses provider-supported efforts and filters disabled models', () => {
  const models = [{ id: 'mini', name: 'Mini', supportedReasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'low' },
    { id: 'plain', name: 'Plain' }, { id: 'disabled', name: 'Disabled', policy: { state: 'disabled' } }] as ModelInfo[];
  assert.deepEqual(copilotModels(models), { models: [
    { id: 'mini', label: 'Mini', efforts: ['low', 'high'], defaultEffort: 'low' },
    { id: 'plain', label: 'Plain', efforts: [], defaultEffort: undefined },
  ], efforts: [], defaultEffortsUnknown: true });
});
