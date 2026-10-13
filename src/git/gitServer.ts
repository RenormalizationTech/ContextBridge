// A minimal MCP server (JSON-RPC over stdio, one message per line) that Claude Code starts in Ask
// mode, offering the read-only Git tools from gitTools.ts. Bundled to dist/git-mcp.cjs and run as
// `<node> git-mcp.cjs <workspace>`.
import { execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { GIT_TOOLS, gitArgs } from './gitTools.ts';

const MAX_OUTPUT = 200 * 1024;
const cwd = process.argv[2] ?? process.cwd();

// Optional locks off: `git status` and `git diff` otherwise refresh the index file. The fsmonitor
// hook (a program from the user's config) is turned off too, so git runs nothing else.
const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' };
const GIT_PREFIX = ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'color.ui=false'];

function runGit(args: string[]): Promise<{ text: string; isError: boolean }> {
  return new Promise((resolve) => {
    execFile('git', [...GIT_PREFIX, ...args], { cwd, env: GIT_ENV, maxBuffer: 16 * 1024 * 1024, timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        resolve({ text: (stderr || error.message).trim() || 'git failed.', isError: true });
        return;
      }
      const text = stdout.length > MAX_OUTPUT
        ? `${stdout.slice(0, MAX_OUTPUT)}\n… (output cut at ${MAX_OUTPUT / 1024} KB; narrow it with paths, stat or maxCount)`
        : stdout || '(no output)';
      resolve({ text, isError: false });
    });
  });
}

async function handle(message: any): Promise<unknown> {
  switch (message.method) {
    case 'initialize':
      return {
        protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'contextbridge', version: '1' },
      };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: GIT_TOOLS };
    case 'tools/call': {
      let args: string[];
      try {
        args = gitArgs(message.params?.name, message.params?.arguments ?? {});
      } catch (error) {
        return { content: [{ type: 'text', text: (error as Error).message }], isError: true };
      }
      const result = await runGit(args);
      return { content: [{ type: 'text', text: result.text }], isError: result.isError };
    }
    default:
      throw Object.assign(new Error(`Method not found: ${message.method}`), { code: -32601 });
  }
}

const send = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);

createInterface({ input: process.stdin }).on('line', (line) => {
  let message: any;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  // Notifications (no id) need no answer.
  if (message.id === undefined || message.id === null) return;
  handle(message).then(
    (result) => send({ jsonrpc: '2.0', id: message.id, result }),
    (error) => send({ jsonrpc: '2.0', id: message.id, error: { code: error.code ?? -32603, message: error.message } }),
  );
});
