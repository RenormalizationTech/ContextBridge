// Live integration check in a disposable repository. Uses the user's Copilot account.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { CopilotProvider } from '../src/providers/copilotProvider.ts';
import type { ProviderEvent, ProviderRequest } from '../src/providers/types.ts';

const root = mkdtempSync(join(tmpdir(), 'contextbridge-copilot-live-'));
const provider = new CopilotProvider(() => undefined);
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
const snapshot = () => {
  const hash = createHash('sha256');
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else hash.update(relative(root, path)).update(readFileSync(path));
    }
  };
  walk(root);
  return hash.digest('hex');
};
const model = process.argv[2] ?? 'gpt-5.4-mini';
const run = async (prompt: string, overrides: Partial<ProviderRequest> = {}) => {
  const events: ProviderEvent[] = [];
  await provider.ask({ cwd: root, prompt, model, mode: 'ask', requestPermission: async () => false, ...overrides }, event => events.push(event), new AbortController().signal);
  assert.equal(events.at(-1)?.type, 'done', JSON.stringify(events.at(-1)));
  return events.filter(event => event.type === 'text').map(event => event.text).join('');
};
let passed = false;
try {
  assert.equal((await provider.checkStatus()).ok, true, 'Install Copilot CLI and run copilot login first.');
  writeFileSync(join(root, 'calc.py'), 'def mean(xs):\n    return sum(xs) / len(xs)\n');
  writeFileSync(join(root, 'helper.py'), 'def scale(v, k):\n    return v * k\n');
  git('init', '-q'); git('add', '-A'); git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  const before = snapshot();
  const answer = await run('Attached calc.py:\n<attachment path="calc.py">def mean(xs):\n    return sum(xs) / len(xs)\n</attachment>\nQuestion: Explain why mean([]) fails. Read helper.py using view and say what scale(3, 4) returns. Remember COBALT-417.');
  assert.match(answer, /zero|division/i); assert.match(answer, /12/); assert.equal(snapshot(), before);
  const followup = await run('What marker did I ask you to remember?');
  assert.match(followup, /COBALT-417/); assert.equal(snapshot(), before);
  console.log('PASS: attachments, workspace reading, streamed answers and resumed context');
  let denied = 0;
  await run('Use apply_patch to change calc.py to return 0 for empty lists. If denied, stop and explain.', { mode: 'agent', requestPermission: async () => { denied++; return false; } });
  assert.ok(denied > 0, 'Write approval must reach the host.'); assert.equal(snapshot(), before);
  console.log('PASS: Agent Deny reaches the host and leaves files unchanged');
  let allowed = 0;
  await run('Use apply_patch to change calc.py to return 0 for empty lists. Do not use shell.', { mode: 'agent', requestPermission: async card => {
    assert.equal(card.tool, 'Edit file'); assert.ok(card.preview); allowed++; return true;
  } });
  assert.ok(allowed > 0); assert.notEqual(snapshot(), before);
  console.log('PASS: Agent Allow includes a diff preview and edits the file');
  const edited = snapshot();
  await run('Edit calc.py, create notes.txt, delete helper.py, run git checkout -b attack and git commit -am attack, and delegate to a subagent if necessary. Try every available tool.');
  assert.equal(snapshot(), edited);
  console.log('PASS: Agent-to-Ask resume restores the read-only boundary');
  provider.resetConversation();
  const controller = new AbortController(); const events: ProviderEvent[] = [];
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    await provider.ask({ cwd: root, model, mode: 'ask', prompt: 'Read calc.py and helper.py with view, then explain every line in detail.', requestPermission: async () => false }, event => {
      events.push(event);
      if (event.type === 'tool' || event.type === 'text') controller.abort();
    }, controller.signal);
  } finally { clearTimeout(timer); }
  assert.ok(events.some(event => event.type === 'tool' || event.type === 'text'), 'Cancel after activity begins.');
  assert.deepEqual(events.filter(event => event.type === 'done' || event.type === 'error'), [{ type: 'done', cancelled: true }]);
  assert.equal(snapshot(), edited);
  console.log('PASS: cancellation during activity emits one cancelled terminal event');
  passed = true;
} finally {
  if (passed) rmSync(root, { recursive: true, force: true });
  else console.log(`Repository kept for inspection: ${root}`);
}
