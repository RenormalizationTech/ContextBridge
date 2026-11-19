import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { AgyProvider } from '../src/providers/agyProvider.ts';
import type { Mode, ModeSession, ProviderEvent } from '../src/providers/types.ts';

const fakeAcp = String.raw`
const fs = require('node:fs');
const readline = require('node:readline');
const args = process.argv.slice(2);
const ask = args.includes('--agent');
const mode = ask ? 'ask' : 'agent';
const log = args[args.indexOf('--log-file') + 1];
const send = (message) => console.log(JSON.stringify({ jsonrpc: '2.0', ...message }));
let promptId;
let sessionId;
const update = (text) => send({
  method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } },
});
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  const reply = (result) => send({ id: message.id, result });
  switch (message.method) {
    case 'initialize':
      reply({ protocolVersion: 1, agentInfo: { version: VERSION }, agentCapabilities: { sessionCapabilities: { resume: {} } } });
      break;
    case 'session/new':
    case 'session/resume':
      if (ask) {
        const dir = args[args.indexOf('--add-dir') + 1];
        const agent = args[args.indexOf('--agent') + 1];
        const definition = fs.readFileSync(dir + '/.agents/agents/' + agent + '.md', 'utf8');
        if (!definition.includes('tools: [view_file, grep_search, find_by_name, list_dir]')) process.exit(7);
        fs.writeFileSync(log, FALLBACK
          ? 'Agent "' + agent + '" not found, falling back to default'
          : 'Failed to resolve GeminiDir, falling back to default');
      }
      if (message.params.sessionId === 'expired') {
        send({ id: message.id, error: { code: -32603, message: 'Conversation not found' } });
        break;
      }
      if (message.params.sessionId && message.params.sessionId !== mode + '-session') process.exit(8);
      sessionId = mode + '-session';
      reply({ sessionId });
      break;
    case 'session/prompt':
      promptId = message.id;
      if (message.params.prompt[0].text.includes('wait for cancellation')) {
        update('Streaming');
        break;
      }
      update(message.params.prompt[0].text);
      send({ id: 'request', method: 'session/request_permission', params: {
        sessionId, toolCall: { kind: 'edit', title: 'sample.txt' },
        options: [{ kind: 'allow_once', optionId: 'allowed' }, { kind: 'reject_once', optionId: 'denied' }],
      } });
      break;
    case 'session/cancel':
      if (message.params.sessionId !== sessionId) process.exit(9);
      send({ id: promptId, result: { stopReason: 'cancelled' } });
      break;
    default:
      update(message.result.outcome.optionId);
      send({ id: promptId, result: { stopReason: 'end_turn' } });
  }
});
`;

async function fixture(version = '1.5.12', fallback = false) {
  const cwd = await mkdtemp(join(tmpdir(), 'cb-fake-agy-'));
  const executable = join(cwd, 'agy');
  await writeFile(executable, `#!${process.execPath}\nconst VERSION = ${JSON.stringify(version)};\nconst FALLBACK = ${fallback};\n${fakeAcp}`, { mode: 0o700 });
  const provider = new AgyProvider(() => executable);
  const sessions: Partial<Record<Mode, ModeSession>> = {};
  async function turn(mode: Mode, { prompt = 'current question', cancel = false, cancelOnApproval = false } = {}) {
    const events: ProviderEvent[] = [];
    const abort = new AbortController();
    let approvals = 0;
    await provider.ask({
      mode, cwd, prompt,
      modeSession: { saved: sessions[mode], recap: 'delta recap', freshRecap: 'fresh recap', save: (session) => { sessions[mode] = session; } },
      requestPermission: async () => {
        approvals++;
        if (cancelOnApproval) abort.abort();
        return true;
      },
    }, (event) => {
      events.push(event);
      if (cancel && event.type === 'text') abort.abort();
    }, abort.signal);
    return { approvals, terminal: events.at(-1), text: events.flatMap((event) => event.type === 'text' ? [event.text] : []).join('') };
  }
  return { cwd, sessions, turn };
}

test('ACP keeps Ask and Agent IDs separate, forwards only Agent approvals, and recaps the correct turns', async (t) => {
  const { cwd, sessions, turn } = await fixture();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const ask = await turn('ask');
  assert.equal(ask.approvals, 0);
  assert.match(ask.text, /fresh recap.*current question.*denied/s);
  const agent = await turn('agent');
  assert.equal(agent.approvals, 1);
  assert.match(agent.text, /allowed$/);
  assert.deepEqual([sessions.ask?.id, sessions.agent?.id], ['ask-session', 'agent-session']);
  assert.match((await turn('ask')).text, /delta recap/);
  assert.deepEqual([sessions.ask?.id, sessions.agent?.id], ['ask-session', 'agent-session']);
  sessions.ask = { id: 'ask-session' };
  assert.match((await turn('ask')).text, /fresh recap/);
  sessions.ask = { id: 'expired', hasContext: true };
  assert.match((await turn('ask')).text, /fresh recap/);
  assert.equal(sessions.ask?.id, 'ask-session');
  assert.deepEqual((await turn('ask', { prompt: 'wait for cancellation', cancel: true })).terminal, { type: 'done', cancelled: true });
  const cancelledApproval = await turn('agent', { cancelOnApproval: true });
  assert.equal(cancelledApproval.approvals, 1);
  assert.deepEqual(cancelledApproval.terminal, { type: 'done', cancelled: true });
});

test('ACP Ask stops before prompting on an unverified build or when the custom agent falls back', async (t) => {
  for (const [version, fallback] of [['1.6.0', false], ['1.5.12', true]] as const) {
    const { cwd, sessions, turn } = await fixture(version, fallback);
    t.after(() => rm(cwd, { recursive: true, force: true }));
    const result = await turn('ask');
    assert.equal(result.text, '');
    assert.equal(result.terminal?.type, 'error');
    assert.equal(sessions.ask, undefined);
  }
});
