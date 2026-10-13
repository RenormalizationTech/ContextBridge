import { spawn, type ChildProcess } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

// Where the official installers put the CLIs, for when VS Code was started without a login-shell PATH.
const COMMON_DIRS = [
  join(homedir(), '.local', 'bin'),
  join(homedir(), '.claude', 'local'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  join(homedir(), '.npm-global', 'bin'),
  join(homedir(), '.bun', 'bin'),
];

let shellPath: Promise<string> | undefined;

// The user's login-shell PATH, so the CLIs and the MCP servers they launch (npx, uvx, ...) resolve
// the same way they do in a terminal. Falls back to the extension host's PATH.
export function loginShellPath(): Promise<string> {
  shellPath ??= new Promise((resolve) => {
    const fallback = process.env.PATH ?? '';
    const shell = process.env.SHELL || '/bin/zsh';
    const child = spawn(shell, ['-ilc', 'printf "__CB_PATH__%s__CB_PATH__" "$PATH"'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    const timer = setTimeout(() => child.kill(), 5000);
    child.stdout.on('data', (chunk) => (output += chunk));
    child.on('error', () => resolve(fallback));
    child.on('close', () => {
      clearTimeout(timer);
      const match = output.match(/__CB_PATH__(.*)__CB_PATH__/s);
      resolve(match ? [match[1], fallback].join(delimiter) : fallback);
    });
  });
  return shellPath;
}

export async function childEnv(): Promise<NodeJS.ProcessEnv> {
  return { ...process.env, PATH: await loginShellPath() };
}

// Resolves an executable from the user's setting, the login-shell PATH, or common install locations.
export async function findExecutable(name: string, configuredPath?: string): Promise<string | undefined> {
  if (configuredPath) return (await isExecutable(configuredPath)) ? configuredPath : undefined;
  const dirs = [...(await loginShellPath()).split(delimiter), ...COMMON_DIRS].filter(Boolean);
  for (const dir of new Set(dirs)) {
    const candidate = join(dir, name);
    if (await isExecutable(candidate)) return candidate;
  }
  return undefined;
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// Calls onLine for each complete line of the child's stdout.
export function readLines(child: ChildProcess, onLine: (line: string) => void): void {
  let buffer = '';
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onLine(line);
    }
  });
}

// Keeps the last few KB of stderr for error messages. Never logged.
export function captureStderr(child: ChildProcess): () => string {
  let tail = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    tail = (tail + chunk).slice(-4000);
  });
  return () => tail.trim();
}

// Runs a short command and returns its output (stdout, then stderr), or undefined if it fails.
export async function runQuiet(command: string, args: string[], timeoutMs = 10000): Promise<string | undefined> {
  const env = await childEnv();
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let errorOutput = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (errorOutput += chunk));
    child.on('error', () => resolve(undefined));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? (output.trim() || errorOutput.trim()) : undefined);
    });
  });
}
