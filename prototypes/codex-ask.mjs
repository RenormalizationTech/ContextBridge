#!/usr/bin/env node
// Phase 1 prototype: ask Codex a question about attached files, in Ask mode.
// Usage: node prototypes/codex-ask.mjs --cwd <dir> [--attach <file>[:start-end]]... -- <question>
// Ctrl+C cancels the request and terminates the provider process.
import { spawn } from 'node:child_process';
import { parseArgs, buildPrompt } from './common.mjs';

const { cwd, attachments, question } = parseArgs(process.argv.slice(2));
// Ask-mode boundary: the read-only sandbox blocks file writes from shell, apply_patch, and git.
const child = spawn('codex', [
  'exec',
  '--json',
  '--ephemeral',
  '--sandbox', 'read-only',
  '-C', cwd,
  '-',
], { stdio: ['pipe', 'pipe', 'ignore'] });

child.stdin.end(buildPrompt(cwd, attachments, question));

let buffer = '';
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line.trim()) handleEvent(JSON.parse(line));
  }
});

// `codex exec --json` emits whole items, not token deltas.
function handleEvent(event) {
  const item = event.item;
  if (event.type === 'item.completed' && item.type === 'agent_message') {
    process.stdout.write(`${item.text}\n\n`);
  } else if (event.type === 'item.started' && item.type === 'command_execution') {
    process.stderr.write(`[command] ${item.command}\n`);
  } else if (event.type === 'item.started' && item.type === 'mcp_tool_call') {
    process.stderr.write(`[mcp] ${item.server}.${item.tool}\n`);
  } else if (event.type === 'turn.completed') {
    process.stderr.write('[done]\n');
  } else if (event.type === 'turn.failed' || event.type === 'error') {
    process.stderr.write(`[error] ${JSON.stringify(event)}\n`);
  }
}

process.on('SIGINT', () => {
  process.stderr.write('\n[cancelled]\n');
  child.kill('SIGTERM');
});
child.on('exit', (code, signal) => process.exit(signal ? 130 : code ?? 0));
