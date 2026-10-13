#!/usr/bin/env node
// Phase 1 prototype: ask Claude Code a question about attached files, in Ask mode.
// Usage: node prototypes/claude-ask.mjs --cwd <dir> [--attach <file>[:start-end]]... -- <question>
// Ctrl+C cancels the request and terminates the provider process.
import { spawn } from 'node:child_process';
import { parseArgs, buildPrompt } from './common.mjs';

// Ask-mode boundary: only read-oriented built-in tools exist, and dontAsk denies
// any tool (including MCP tools) not on the allow list instead of prompting.
const READ_TOOLS = 'Read,Grep,Glob,WebFetch,WebSearch,Agent';

const { cwd, attachments, question } = parseArgs(process.argv.slice(2));
const child = spawn('claude', [
  '-p',
  '--output-format', 'stream-json',
  '--verbose',
  '--include-partial-messages',
  '--no-session-persistence',
  '--permission-mode', 'dontAsk',
  '--tools', `${READ_TOOLS},ToolSearch`,
  '--allowedTools', READ_TOOLS,
], { cwd, stdio: ['pipe', 'pipe', 'inherit'] });

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

function handleEvent(event) {
  if (event.type === 'stream_event' && event.event?.delta?.type === 'text_delta') {
    process.stdout.write(event.event.delta.text);
  } else if (event.type === 'assistant') {
    for (const block of event.message.content) {
      if (block.type === 'tool_use') process.stderr.write(`\n[tool] ${block.name} ${JSON.stringify(block.input)}\n`);
    }
  } else if (event.type === 'result') {
    process.stderr.write(`\n[done] ${event.subtype}, denials: ${event.permission_denials?.length ?? 0}\n`);
  }
}

process.on('SIGINT', () => {
  process.stderr.write('\n[cancelled]\n');
  child.kill('SIGTERM');
});
child.on('exit', (code, signal) => process.exit(signal ? 130 : code ?? 0));
