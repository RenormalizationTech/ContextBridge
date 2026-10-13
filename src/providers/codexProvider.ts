import { spawn } from 'node:child_process';
import { withLoginHint } from './claudeStream.ts';
import { listAppServerModels, runAppServerTurn } from './codexAppServer.ts';
import { CodexStreamParser } from './codexStream.ts';
import { captureStderr, childEnv, findExecutable, readLines, runQuiet } from './process.ts';
import type { ModelCatalog, Provider, ProviderEvent, ProviderRequest, ProviderStatus } from './types.ts';

const NOT_FOUND = 'Codex CLI not found. Install it, or set "contextBridge.codex.path" to the codex executable.';
// `exec` transport only (see codexAppServer.ts for the default app-server transport).
// Ask-mode boundary: the read-only sandbox blocks writes from shell, apply_patch and git (validated
// in Phase 1). `exec` can't ask for approvals, so Agent mode uses workspace-write: edits and commands
// inside the workspace only. Set through config because `codex exec resume` has no --sandbox flag.
const SANDBOX = { ask: 'read-only', agent: 'workspace-write' } as const;

export type CodexTransport = 'app-server' | 'exec';
// Codex's own web search tool: live fetches current pages, cached uses OpenAI's index of
// previously fetched pages, disabled turns it off. Shell commands stay offline in the sandbox.
export type CodexWebSearch = 'live' | 'cached' | 'disabled';

export class CodexProvider implements Provider {
  readonly id = 'codex';
  readonly label = 'Codex';
  #threadId?: string;
  readonly #configuredPath: () => string | undefined;
  readonly #transport: () => CodexTransport;
  readonly #webSearch: () => CodexWebSearch;

  // `app-server` streams answers and supports approvals; `exec` is the simpler fallback.
  constructor(
    configuredPath: () => string | undefined,
    transport: () => CodexTransport = () => 'app-server',
    webSearch: () => CodexWebSearch = () => 'live',
  ) {
    this.#configuredPath = configuredPath;
    this.#transport = transport;
    this.#webSearch = webSearch;
  }

  get streamsTokens(): boolean {
    return this.#transport() === 'app-server';
  }

  resetConversation(): void {
    this.#threadId = undefined;
  }

  get conversationId(): string | undefined {
    return this.#threadId;
  }

  restoreConversation(id: string | undefined): void {
    this.#threadId = id;
  }

  // Listed through the app server for either transport; it's the only structured model list.
  async listModels(cwd: string): Promise<ModelCatalog | undefined> {
    const executable = await findExecutable('codex', this.#configuredPath());
    return executable ? listAppServerModels(executable, cwd) : undefined;
  }

  async checkStatus(): Promise<ProviderStatus> {
    const executable = await findExecutable('codex', this.#configuredPath());
    if (!executable) return { ok: false, installed: false, detail: NOT_FOUND };
    const version = (await runQuiet(executable, ['--version']))?.split(' ').at(-1) ?? 'unknown version';
    const login = await runQuiet(executable, ['login', 'status']);
    if (!login) return { ok: false, installed: true, detail: `Codex ${version}: not logged in. Run \`codex login\` in a terminal.` };
    return { ok: true, installed: true, detail: `Codex ${version}, ${login.charAt(0).toLowerCase()}${login.slice(1)}` };
  }

  async ask(request: ProviderRequest, onEvent: (event: ProviderEvent) => void, signal: AbortSignal): Promise<void> {
    const executable = await findExecutable('codex', this.#configuredPath());
    if (!executable) {
      onEvent({ type: 'error', message: NOT_FOUND });
      return;
    }
    if (this.#transport() === 'app-server') {
      this.#threadId = await runAppServerTurn(executable, request, this.#webSearch(), this.#threadId, onEvent, signal);
      return;
    }
    const sandbox = SANDBOX[request.mode];
    const config = ['-c', `sandbox_mode="${sandbox}"`, '-c', `web_search="${this.#webSearch()}"`];
    if (request.model) config.push('-m', request.model);
    if (request.effort) config.push('-c', `model_reasoning_effort="${request.effort}"`);
    const args = this.#threadId
      ? ['exec', 'resume', '--json', '--skip-git-repo-check', ...config, this.#threadId, '-']
      : ['exec', '--json', '--skip-git-repo-check', ...config, '--sandbox', sandbox, '-'];

    const child = spawn(executable, args, { cwd: request.cwd, env: await childEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    const stderr = captureStderr(child);
    const parser = new CodexStreamParser();
    let terminal = false;
    const emit = (event: ProviderEvent) => {
      if (terminal) return;
      if (event.type === 'done' || event.type === 'error') terminal = true;
      onEvent(event);
    };

    const onAbort = () => {
      emit({ type: 'done', cancelled: true });
      child.kill('SIGTERM');
    };
    signal.addEventListener('abort', onAbort, { once: true });

    readLines(child, (line) => {
      // Output still buffered after a cancel belongs to a finished request.
      if (signal.aborted) return;
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      for (const providerEvent of parser.handle(event)) emit(providerEvent);
      if (parser.threadId) this.#threadId = parser.threadId;
    });

    // `exec --json` doesn't report the model, so only a chosen one is shown.
    if (request.model) emit({ type: 'model', model: request.model, effort: request.effort });
    child.stdin.end(request.prompt);

    await new Promise<void>((resolve) => {
      child.on('error', (error) => {
        emit({ type: 'error', message: `Could not start Codex: ${error.message}` });
        resolve();
      });
      child.on('close', (code) => {
        signal.removeEventListener('abort', onAbort);
        if (!terminal) {
          const detail = parser.lastError || stderr().split('\n').filter((line) => !/^\d{4}-\d\d-\d\dT/.test(line)).slice(-5).join('\n') || `exit code ${code}`;
          emit({ type: 'error', message: withLoginHint(`Codex exited before answering: ${detail}`) });
        }
        resolve();
      });
    });
  }
}
