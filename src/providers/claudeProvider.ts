import { spawn } from 'node:child_process';
import { ASK_MODE_TOOLS, ClaudeStreamParser, permissionFor, withLoginHint } from './claudeStream.ts';
import { captureStderr, childEnv, findExecutable, readLines, runQuiet } from './process.ts';
import type { Provider, ProviderEvent, ProviderRequest, ProviderStatus } from './types.ts';

const NOT_FOUND = 'Claude Code CLI not found. Install it, or set "contextBridge.claude.path" to the claude executable.';

export class ClaudeProvider implements Provider {
  readonly id = 'claude';
  readonly label = 'Claude Code';
  readonly streamsTokens = true;
  #sessionId?: string;
  readonly #configuredPath: () => string | undefined;

  constructor(configuredPath: () => string | undefined) {
    this.#configuredPath = configuredPath;
  }

  resetConversation(): void {
    this.#sessionId = undefined;
  }

  async checkStatus(): Promise<ProviderStatus> {
    const executable = await findExecutable('claude', this.#configuredPath());
    if (!executable) return { ok: false, detail: NOT_FOUND };
    const version = (await runQuiet(executable, ['--version']))?.split(' ')[0] ?? 'unknown version';
    try {
      const auth = JSON.parse((await runQuiet(executable, ['auth', 'status'])) ?? '{}');
      if (!auth.loggedIn) return { ok: false, detail: `Claude Code ${version}: not logged in. Run \`claude\` in a terminal to log in.` };
      return { ok: true, detail: `Claude Code ${version}, logged in${auth.authMethod ? ` (${auth.authMethod})` : ''}` };
    } catch {
      return { ok: true, detail: `Claude Code ${version}` };
    }
  }

  async ask(request: ProviderRequest, onEvent: (event: ProviderEvent) => void, signal: AbortSignal): Promise<void> {
    const executable = await findExecutable('claude', this.#configuredPath());
    if (!executable) {
      onEvent({ type: 'error', message: NOT_FOUND });
      return;
    }
    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      // Ask-mode boundary: only read-oriented built-in tools exist.
      '--tools', ASK_MODE_TOOLS.join(','),
      // Remaining permission prompts come to us over stdio (see permissionFor).
      '--permission-mode', 'default',
      '--permission-prompt-tool', 'stdio',
    ];
    if (this.#sessionId) args.push('--resume', this.#sessionId);

    const child = spawn(executable, args, { cwd: request.cwd, env: await childEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    const stderr = captureStderr(child);
    const parser = new ClaudeStreamParser(request.cwd);
    const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
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
      if (event.type === 'control_request') {
        const request = event.request ?? {};
        if (request.subtype !== 'can_use_tool') {
          send({ type: 'control_response', response: { subtype: 'error', request_id: event.request_id, error: 'Unsupported request' } });
          return;
        }
        const decision = permissionFor(request.tool_name);
        const response = decision.behavior === 'allow' ? { ...decision, updatedInput: request.input } : decision;
        send({ type: 'control_response', response: { subtype: 'success', request_id: event.request_id, response } });
        return;
      }
      for (const providerEvent of parser.handle(event)) emit(providerEvent);
      if (parser.sessionId) this.#sessionId = parser.sessionId;
      if (parser.finished) child.stdin.end();
    });

    send({ type: 'user', message: { role: 'user', content: request.prompt } });

    await new Promise<void>((resolve) => {
      child.on('error', (error) => {
        emit({ type: 'error', message: `Could not start Claude Code: ${error.message}` });
        resolve();
      });
      child.on('close', (code) => {
        signal.removeEventListener('abort', onAbort);
        if (!terminal) {
          const detail = stderr() || `exit code ${code}`;
          emit({ type: 'error', message: withLoginHint(`Claude Code exited before answering: ${detail}`) });
        }
        resolve();
      });
    });
  }
}
