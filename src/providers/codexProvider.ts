import { spawn } from 'node:child_process';
import { withLoginHint } from './claudeStream.ts';
import { CodexStreamParser } from './codexStream.ts';
import { captureStderr, childEnv, findExecutable, readLines, runQuiet } from './process.ts';
import type { Provider, ProviderEvent, ProviderRequest, ProviderStatus } from './types.ts';

const NOT_FOUND = 'Codex CLI not found. Install it, or set "contextBridge.codex.path" to the codex executable.';
// Ask-mode boundary: the read-only sandbox blocks writes from shell, apply_patch and git (validated
// in Phase 1). Set through config because `codex exec resume` has no --sandbox flag.
const READ_ONLY = ['-c', 'sandbox_mode="read-only"'];

export class CodexProvider implements Provider {
  readonly id = 'codex';
  readonly label = 'Codex';
  readonly streamsTokens = false;
  #threadId?: string;
  readonly #configuredPath: () => string | undefined;

  constructor(configuredPath: () => string | undefined) {
    this.#configuredPath = configuredPath;
  }

  resetConversation(): void {
    this.#threadId = undefined;
  }

  async checkStatus(): Promise<ProviderStatus> {
    const executable = await findExecutable('codex', this.#configuredPath());
    if (!executable) return { ok: false, detail: NOT_FOUND };
    const version = (await runQuiet(executable, ['--version']))?.split(' ').at(-1) ?? 'unknown version';
    const login = await runQuiet(executable, ['login', 'status']);
    if (!login) return { ok: false, detail: `Codex ${version}: not logged in. Run \`codex login\` in a terminal.` };
    return { ok: true, detail: `Codex ${version}, ${login.charAt(0).toLowerCase()}${login.slice(1)}` };
  }

  async ask(request: ProviderRequest, onEvent: (event: ProviderEvent) => void, signal: AbortSignal): Promise<void> {
    const executable = await findExecutable('codex', this.#configuredPath());
    if (!executable) {
      onEvent({ type: 'error', message: NOT_FOUND });
      return;
    }
    const args = this.#threadId
      ? ['exec', 'resume', '--json', '--skip-git-repo-check', ...READ_ONLY, this.#threadId, '-']
      : ['exec', '--json', '--skip-git-repo-check', ...READ_ONLY, '--sandbox', 'read-only', '-'];

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
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      for (const providerEvent of parser.handle(event)) emit(providerEvent);
      if (parser.threadId) this.#threadId = parser.threadId;
    });

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
