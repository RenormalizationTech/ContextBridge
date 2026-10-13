import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { ASK_MODE_TOOLS, askModePermission, ClaudeStreamParser, describeToolCall, withLoginHint } from './claudeStream.ts';
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

  get conversationId(): string | undefined {
    return this.#sessionId;
  }

  restoreConversation(id: string | undefined): void {
    this.#sessionId = id;
  }

  async checkStatus(): Promise<ProviderStatus> {
    const executable = await findExecutable('claude', this.#configuredPath());
    if (!executable) return { ok: false, installed: false, detail: NOT_FOUND };
    const version = (await runQuiet(executable, ['--version']))?.split(' ')[0] ?? 'unknown version';
    try {
      const auth = JSON.parse((await runQuiet(executable, ['auth', 'status'])) ?? '{}');
      if (!auth.loggedIn) return { ok: false, installed: true, detail: `Claude Code ${version}: not logged in. Run \`claude\` in a terminal to log in.` };
      return { ok: true, installed: true, detail: `Claude Code ${version}, logged in${auth.authMethod ? ` (${auth.authMethod})` : ''}` };
    } catch {
      return { ok: true, installed: true, detail: `Claude Code ${version}` };
    }
  }

  // Answers a `can_use_tool` control request: by rule in Ask mode, by the user in Agent mode.
  async #decide(control: any, request: ProviderRequest, signal: AbortSignal): Promise<boolean> {
    if (request.mode === 'ask') return askModePermission(control.tool_name).behavior === 'allow';
    if (signal.aborted) return false;
    const { detail, preview } = describeToolCall(control.tool_name, control.input ?? {});
    const tool = control.display_name && control.display_name !== control.tool_name
      ? `${control.display_name} (${control.tool_name})`
      : control.tool_name;
    return request.requestPermission({ tool, detail, preview });
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
      // Permission prompts come to us over stdio: answered by askModePermission in Ask mode,
      // or by the user in Agent mode. Claude's own allow/deny rules from settings still apply first.
      '--permission-mode', 'default',
      '--permission-prompt-tool', 'stdio',
    ];
    // Ask-mode boundary: only read-oriented built-in tools exist. Agent mode keeps the default tool set.
    if (request.mode === 'ask') args.push('--tools', ASK_MODE_TOOLS.join(','));
    if (this.#sessionId) args.push('--resume', this.#sessionId);

    const child = spawn(executable, args, { cwd: request.cwd, env: await childEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    const stderr = captureStderr(child);
    // The CLI reports real paths (e.g. /private/var on macOS), so compare against the real cwd.
    const parser = new ClaudeStreamParser(realCwd(request.cwd));
    const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
    let terminal = false;
    let sessionLost = false;
    const emit = (event: ProviderEvent) => {
      if (terminal) return;
      if (event.type === 'done' || event.type === 'error') terminal = true;
      // Claude Code deletes old sessions (cleanupPeriodDays), so a chat reopened from history may
      // not be resumable. Start a fresh CLI conversation on the next question instead.
      if (event.type === 'error' && /No conversation found/i.test(stderr())) {
        sessionLost = true;
        event = { type: 'error', message: 'Claude Code no longer has this conversation (old sessions are cleaned up by the CLI). Ask again to continue in a new Claude Code conversation; the messages above stay here for reference.' };
      }
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
      if (event.type === 'control_request') {
        const control = event.request ?? {};
        if (control.subtype !== 'can_use_tool') {
          send({ type: 'control_response', response: { subtype: 'error', request_id: event.request_id, error: 'Unsupported request' } });
          return;
        }
        void this.#decide(control, request, signal).then((allowed) => {
          const response = allowed
            ? { behavior: 'allow', updatedInput: control.input }
            : { behavior: 'deny', message: request.mode === 'ask' ? 'ContextBridge Ask mode does not allow this tool.' : 'The user denied this action.' };
          if (child.stdin.writable) send({ type: 'control_response', response: { subtype: 'success', request_id: event.request_id, response } });
        });
        return;
      }
      for (const providerEvent of parser.handle(event)) emit(providerEvent);
      if (parser.sessionId) this.#sessionId = sessionLost ? undefined : parser.sessionId;
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

function realCwd(cwd: string): string {
  try {
    return realpathSync(cwd);
  } catch {
    return cwd;
  }
}
