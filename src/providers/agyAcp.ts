import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { captureStderr, childEnv, readLines } from './process.ts';

interface Message {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: string | { message?: string } };
}

export class AcpError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export class AgyAcp {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #closed: Promise<void>;
  readonly #pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>();
  #nextId = 0;
  #failure?: Error;
  #stopping = false;

  onUpdate?: (params: unknown) => void;
  onPermission?: (params: unknown) => Promise<unknown>;

  static async start(executable: string, args: string[], cwd: string, signal?: AbortSignal): Promise<AgyAcp> {
    const env = await childEnv();
    signal?.throwIfAborted();
    return new AgyAcp(spawn(executable, ['acp', ...args], { cwd, env, windowsHide: true }));
  }

  private constructor(child: ChildProcessWithoutNullStreams) {
    this.#child = child;
    this.#closed = new Promise((resolve) => child.once('close', () => resolve()));
    const stderr = captureStderr(child);
    child.on('error', (error) => this.#fail(error));
    child.stdin.on('error', (error) => this.#fail(error));
    child.on('close', (code) => this.#fail(new Error(`Antigravity ACP exited (${code ?? 'terminated'})${stderr() ? `: ${stderr()}` : ''}`)));
    readLines(child, (line) => this.#receive(line));
  }

  async request<T>(method: string, params: object, timeoutMs = 30_000): Promise<T> {
    if (this.#failure) throw this.#failure;
    const id = ++this.#nextId;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await new Promise<T>((resolve, reject) => {
        this.#pending.set(id, { resolve: (value) => resolve(value as T), reject });
        if (timeoutMs) timer = setTimeout(() => reject(new Error(`Antigravity ACP timed out during ${method}.`)), timeoutMs);
        this.#send({ id, method, params });
      });
    } finally {
      clearTimeout(timer);
      this.#pending.delete(id);
    }
  }

  notify(method: string, params: object): void {
    this.#send({ method, params });
  }

  async close(): Promise<void> {
    this.#child.stdin.end();
    const timer = setTimeout(() => this.stop(), 1500);
    try {
      await this.#closed;
    } finally {
      clearTimeout(timer);
    }
  }

  stop(): void {
    if (this.#stopping || this.#child.exitCode !== null || this.#child.signalCode !== null) return;
    this.#stopping = true;
    this.#fail(new Error('Antigravity ACP connection closed.'));
    this.#child.kill();
    const timer = setTimeout(() => this.#child.kill('SIGKILL'), 1500);
    timer.unref();
    this.#child.once('close', () => clearTimeout(timer));
  }

  #send(message: Message): void {
    if (!this.#failure && this.#child.stdin.writable) {
      this.#child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
    }
  }

  #receive(line: string): void {
    let message: Message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!message || typeof message !== 'object') return;
    const { id, method, params, error } = message;
    if (method && id !== undefined) {
      if (method === 'session/request_permission') {
        void (this.onPermission?.(params) ?? Promise.resolve({ outcome: { outcome: 'cancelled' } })).then(
          (result) => this.#send({ id, result }),
          () => this.#send({ id, result: { outcome: { outcome: 'cancelled' } } }),
        );
      } else {
        this.#send({ id, error: { code: -32601, message: 'Client method not supported' } });
      }
    } else if (method === 'session/update') {
      this.onUpdate?.(params);
    } else if (typeof id === 'number') {
      const pending = this.#pending.get(id);
      if (error) {
        const detail = typeof error.data === 'string' ? error.data : error.data?.message;
        pending?.reject(new AcpError(error.code, detail && detail !== error.message ? `${error.message}: ${detail}` : error.message));
      }
      else pending?.resolve(message.result);
    }
  }

  #fail(error: Error): void {
    this.#failure ??= error;
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }
}
