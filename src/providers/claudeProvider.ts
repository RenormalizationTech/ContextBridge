import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { ASK_MODE_TOOLS, askModePermission, claudeCatalog, ClaudeStreamParser, claudeModelCatalog, describeToolCall, withLoginHint } from './claudeStream.ts';
import { captureStderr, childEnv, findExecutable, readLines, runQuiet } from './process.ts';
import type { ModelCatalog, Provider, ProviderEvent, ProviderRequest, ProviderStatus } from './types.ts';

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

  async listModels(cwd: string): Promise<ModelCatalog | undefined> {
    const executable = await findExecutable('claude', this.#configuredPath());
    if (!executable) return undefined;
    const answers = await askControl(executable, cwd, [], ['initialize', 'get_settings']);
    return claudeCatalog(answers.initialize, answers.get_settings) ?? claudeModelCatalog(await runQuiet(executable, ['--help']));
  }

  async defaultEffort(model: string, cwd: string): Promise<string | undefined> {
    const executable = await findExecutable('claude', this.#configuredPath());
    if (!executable) return undefined;
    return (await askControl(executable, cwd, ['--model', model], ['get_settings'])).get_settings?.applied?.effort ?? undefined;
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
    return request.requestPermission({ tool, detail, preview, always: alwaysScope(control.tool_name, detail) });
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
    // A resumed session can switch models; the conversation carries over.
    if (request.model) args.push('--model', request.model);
    if (request.effort) args.push('--effort', request.effort);
    if (this.#sessionId) args.push('--resume', this.#sessionId);

    const child = spawn(executable, args, { cwd: request.cwd, env: await childEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    const stderr = captureStderr(child);
    // The CLI reports real paths (e.g. /private/var on macOS), so compare against the real cwd.
    const parser = new ClaudeStreamParser(realCwd(request.cwd));
    const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
    let terminal = false;
    let sessionLost = false;
    // The footer's model and effort come from `get_settings` (what the CLI actually applies). If
    // the CLI can't answer it, the init event's model is used with the requested effort.
    let settings: 'pending' | 'reported' | 'failed' = 'pending';
    let initModel: ProviderEvent | undefined;
    const emit = (event: ProviderEvent) => {
      if (terminal) return;
      if (event.type === 'done' || event.type === 'error') {
        terminal = true;
        // The CLI never answered get_settings.
        if (settings === 'pending' && initModel) onEvent(initModel);
      }
      // The init event's model (get_settings' answer is emitted directly, already confirmed).
      if (event.type === 'model' && !event.effortConfirmed) {
        if (settings === 'reported') return;
        event = { ...event, effort: request.effort };
        if (settings === 'pending') {
          initModel = event;
          return;
        }
      }
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
      if (event.type === 'control_response' && event.response?.request_id === SETTINGS_REQUEST) {
        const applied = event.response.response?.applied;
        if (event.response.subtype === 'success' && typeof applied?.model === 'string') {
          emit({ type: 'model', model: applied.model, effort: applied.effort ?? undefined, effortConfirmed: true });
          settings = 'reported';
        } else {
          settings = 'failed';
          if (initModel) emit(initModel);
        }
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

    send({ type: 'control_request', request_id: SETTINGS_REQUEST, request: { subtype: 'get_settings' } });
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

const SETTINGS_REQUEST = 'contextbridge-settings';

// Asks a `claude -p` process control questions without sending a message, so there's no model
// call: `initialize` lists the models, `get_settings` reports the model and effort that apply.
// Unanswered questions are missing from the result.
async function askControl(executable: string, cwd: string, args: string[], subtypes: string[], timeoutMs = 15000): Promise<Record<string, any>> {
  const child = spawn(executable, ['-p', ...args, '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'], {
    cwd,
    env: await childEnv(),
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const answers: Record<string, any> = {};
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    let remaining = subtypes.length;
    const finish = () => {
      clearTimeout(timer);
      resolve();
    };
    child.on('error', finish);
    child.on('close', finish);
    readLines(child, (line) => {
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event.type !== 'control_response' || !subtypes.includes(event.response?.request_id)) return;
      if (event.response.subtype === 'success') answers[event.response.request_id] = event.response.response;
      if (--remaining === 0) finish();
    });
    for (const subtype of subtypes) child.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: subtype, request: { subtype } })}\n`);
  });
  child.kill('SIGTERM');
  return answers;
}

function realCwd(cwd: string): string {
  try {
    return realpathSync(cwd);
  } catch {
    return cwd;
  }
}

// What "Always allow" covers for a Claude Code tool: all edits, one exact command, or one tool.
function alwaysScope(toolName: string, detail: string): { key: string; label: string } {
  if (['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(toolName)) {
    return { key: 'edits', label: 'Allow all file edits for the rest of this chat' };
  }
  if (toolName === 'Bash') return { key: `command:${detail}`, label: 'Allow this exact command for the rest of this chat' };
  return { key: `tool:${toolName}`, label: `Allow ${toolName} for the rest of this chat` };
}
