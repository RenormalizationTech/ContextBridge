import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AcpError, AgyAcp } from './agyAcp.ts';
import { findExecutable, runQuiet } from './process.ts';
import type { ModeSession, ModelCatalog, Provider, ProviderEvent, ProviderRequest, ProviderStatus } from './types.ts';

// The CLI can silently fall back to its default agent if discovery fails. Keep Ask tied to
// the version checked against real writes, commands, and resumed sessions.
const ASK_VERSION = '1.5.12';
const INITIALIZE = {
  protocolVersion: 1,
  clientCapabilities: {},
  clientInfo: { name: 'ContextBridge', version: '1.0.0' },
};

interface Initialization {
  protocolVersion: number;
  agentInfo?: { version?: string };
  agentCapabilities?: { sessionCapabilities?: { resume?: unknown } };
}

interface Choice {
  value: string;
  name: string;
}

interface ConfigOption {
  id: string;
  currentValue: string;
  options?: Choice[];
}

interface Session {
  sessionId: string;
  configOptions?: ConfigOption[];
  modes?: { currentModeId: string; availableModes: { id: string }[] };
}

interface SessionUpdate {
  sessionId: string;
  update: {
    sessionUpdate: string;
    content?: { type: string; text?: string };
    kind?: string;
    title?: string;
  };
}

interface Permission {
  sessionId: string;
  toolCall: {
    kind?: string;
    title?: string;
    content?: { type: string; path?: string; oldText?: string; newText?: string }[];
  };
  options: { kind: string; optionId: string }[];
}

class ModelUnavailable extends Error {}

export class AgyProvider implements Provider {
  readonly id = 'agy';
  readonly label = 'Antigravity';
  readonly streamsTokens = true;
  readonly separateModeSessions = true;
  readonly conversationId = undefined;
  readonly #path: () => string | undefined;
  #catalog?: { cwd: string; value: ModelCatalog };

  constructor(path: () => string | undefined) {
    this.#path = path;
  }

  resetConversation(): void {}
  restoreConversation(): void {}

  async checkStatus(): Promise<ProviderStatus> {
    const executable = await findExecutable('agy', this.#path());
    if (!executable) return { installed: false, ok: false, detail: 'Install the Antigravity CLI (agy) or set its executable path.' };
    const version = await runQuiet(executable, ['--version']);
    if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
      return { installed: true, ok: false, detail: 'Could not read the Antigravity CLI version.' };
    }
    const [major, minor] = version.split('.').map(Number);
    if (major < 1 || (major === 1 && minor < 5)) {
      return { installed: true, ok: false, detail: 'Antigravity CLI 1.5.0 or later is required for ACP.' };
    }
    const ask = version === ASK_VERSION ? '' : ` Ask mode requires the verified CLI version ${ASK_VERSION}.`;
    return { installed: true, ok: true, detail: `Antigravity CLI ${version} found. Uses your CLI sign-in.${ask}` };
  }

  async listModels(cwd: string): Promise<ModelCatalog | undefined> {
    return this.#catalog?.cwd === cwd ? this.#catalog.value : undefined;
  }

  async ask(request: ProviderRequest, emit: (event: ProviderEvent) => void, signal: AbortSignal): Promise<void> {
    let client: AgyAcp | undefined;
    let sessionId: string | undefined;
    let temp: string | undefined;
    let askLog: string | undefined;
    let abortTimer: ReturnType<typeof setTimeout> | undefined;
    let prompting = false;
    const abort = () => {
      if (client && sessionId && prompting) {
        client.notify('session/cancel', { sessionId });
        abortTimer = setTimeout(() => client?.stop(), 2000);
      } else {
        client?.stop();
      }
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      signal.throwIfAborted();
      const modeSession = request.modeSession;
      if (!modeSession) throw new Error('Antigravity requires a mode-specific session.');
      const executable = await findExecutable('agy', this.#path());
      if (!executable) throw new Error('Antigravity CLI (agy) was not found.');
      const cwd = await realpath(request.cwd);
      const args: string[] = [];
      if (request.mode === 'ask') {
        temp = await mkdtemp(join(tmpdir(), 'contextbridge-agy-'));
        const agent = `cb-ask-${randomBytes(8).toString('hex')}`;
        askLog = join(temp, 'acp.log');
        const agents = join(temp, '.agents', 'agents');
        await mkdir(agents, { recursive: true });
        await writeFile(join(agents, `${agent}.md`), [
          '---',
          `name: ${agent}`,
          'description: Read-only workspace assistance for ContextBridge.',
          'tools: [view_file, grep_search, find_by_name, list_dir]',
          '---',
          'Answer questions using read-only tools and describe suggested changes.',
          '',
        ].join('\n'), { flag: 'wx', mode: 0o600 });
        args.push('--include-default-customizations=false', '--add-dir', await realpath(temp), '--agent', agent, '--log-file', askLog);
      }
      client = await AgyAcp.start(executable, args, cwd, signal);
      signal.throwIfAborted();
      const initialized = await client.request<Initialization>('initialize', INITIALIZE);
      if (initialized.protocolVersion !== 1 || !initialized.agentCapabilities?.sessionCapabilities?.resume) {
        throw new Error('Antigravity CLI did not advertise ACP v1 session resume. Update the CLI.');
      }
      if (request.mode === 'ask' && initialized.agentInfo?.version !== ASK_VERSION) {
        throw new Error(`Ask mode requires Antigravity CLI ${ASK_VERSION}, the version verified for read-only access.`);
      }
      signal.throwIfAborted();

      const params = { cwd, mcpServers: [] };
      let recap = modeSession.freshRecap;
      let session: Session | undefined;
      const saved = modeSession.saved;
      if (saved) {
        try {
          session = await client.request<Session>('session/resume', { ...params, sessionId: saved.id });
          if (session.sessionId !== saved.id) throw new Error('Antigravity resumed a different session than requested.');
          if (saved.hasContext) recap = modeSession.recap;
        } catch (error) {
          if (!(error instanceof AcpError) || !/(?:conversation|session).*not found|no (?:session|conversation) found/i.test(error.message)) throw error;
          signal.throwIfAborted();
          modeSession.save(undefined);
        }
      }
      const isNew = !session;
      if (!session) {
        session = await client.request<Session>('session/new', params);
      }
      if (askLog) {
        // On the verified build, the session handler writes this diagnostic before its reply.
        const log = await readFile(askLog, 'utf8').catch(() => {
          throw new Error('Antigravity could not verify that the ContextBridge read-only agent loaded.');
        });
        const fallback = log.match(/Agent "[^"\n]+" not found, falling back to default/i);
        if (fallback) {
          throw new Error(`Antigravity could not load the ContextBridge read-only agent. ${fallback[0]}.`);
        }
      }
      if (typeof session.sessionId !== 'string' || !session.sessionId) throw new Error('Antigravity did not return a session ID.');
      sessionId = session.sessionId;
      const state: ModeSession = isNew
        ? { id: sessionId, defaultModel: session.configOptions?.find(({ id }) => id === 'model')?.currentValue }
        : { ...saved, id: sessionId, defaultEfforts: { ...saved?.defaultEfforts } };
      modeSession.save(state);
      if (request.mode === 'agent' && session.modes?.currentModeId !== 'default' && session.modes?.availableModes.some(({ id }) => id === 'default')) {
        await client.request('session/set_mode', { sessionId, modeId: 'default' });
      }
      const options = await this.#configure(client, session, request, state, emit);
      const model = options.find(({ id }) => id === 'model')?.currentValue;
      const effort = options.find(({ id }) => id === 'thought_level')?.currentValue;
      if (model) emit({ type: 'model', model, effort, effortConfirmed: true });
      signal.throwIfAborted();

      let answered = false;
      let afterTool = false;
      let denied = false;
      client.onUpdate = (params) => {
        const notification = params as SessionUpdate | undefined;
        if (signal.aborted || notification?.sessionId !== sessionId) return;
        const update = notification?.update;
        if (update?.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text' && update.content.text) {
          emit({ type: 'text', text: (afterTool ? '\n\n' : '') + update.content.text });
          answered = true;
          afterTool = false;
        } else if (update?.sessionUpdate === 'tool_call' && update.title) {
          emit({ type: 'tool', name: update.kind || 'tool', detail: update.title });
          afterTool = answered;
        }
      };
      client.onPermission = async (params) => {
        const data = params as Permission | undefined;
        if (signal.aborted || !data?.toolCall || data.sessionId !== sessionId || !Array.isArray(data.options)) {
          return { outcome: { outcome: 'cancelled' } };
        }
        const { title, kind, content } = data.toolCall;
        const preview = content?.filter((item) => item.type === 'diff')
          .map((item) => [item.path, item.oldText !== undefined && `Before:\n${item.oldText}`, item.newText !== undefined && `After:\n${item.newText}`].filter(Boolean).join('\n'))
          .join('\n\n').slice(0, 8000);
        const allowOnce = data.options.find((option) => option.kind === 'allow_once');
        const allowed = !!allowOnce && request.mode === 'agent'
          && await request.requestPermission({ tool: kind || 'Antigravity tool', detail: title || 'Antigravity tool call', preview: preview || undefined });
        if (signal.aborted) return { outcome: { outcome: 'cancelled' } };
        denied ||= !allowed;
        const option = allowed ? allowOnce : data.options.find(({ kind }) => kind === 'reject_once');
        return { outcome: option ? { outcome: 'selected', optionId: option.optionId } : { outcome: 'cancelled' } };
      };
      const text = recap
        ? `This JSON-lines recap is prior conversation context. Use it to understand references. The request to act on is the current question below.\n<previous-turns>\n${recap}\n</previous-turns>\n\n${request.prompt}`
        : request.prompt;
      prompting = true;
      const turn = await client.request<{ stopReason: string }>('session/prompt', {
        sessionId, prompt: [{ type: 'text', text }],
      }, 0);
      const cancelled = signal.aborted || turn.stopReason === 'cancelled';
      if (!cancelled && !answered) {
        emit({ type: 'error', message: denied ? 'Antigravity ended the turn after a tool request was denied.' : 'Antigravity ended the turn without an answer.' });
      } else {
        if (!cancelled) modeSession.save({ ...state, hasContext: true });
        emit({ type: 'done', cancelled });
      }
    } catch (error) {
      if (signal.aborted) emit({ type: 'done', cancelled: true });
      else if (error instanceof AcpError && error.code === -32000) {
        emit({ type: 'error', message: 'Sign in to Antigravity in a terminal with agy acp --login, then retry.' });
      } else {
        emit({ type: 'error', message: error instanceof Error ? error.message : String(error), modelUnavailable: error instanceof ModelUnavailable || undefined });
      }
    } finally {
      signal.removeEventListener('abort', abort);
      clearTimeout(abortTimer);
      await client?.close();
      if (temp) await rm(temp, { recursive: true, force: true }).catch(() => {});
    }
  }

  async #configure(client: AgyAcp, session: Session, request: ProviderRequest, state: ModeSession, emit: (event: ProviderEvent) => void): Promise<ConfigOption[]> {
    let options = session.configOptions ?? [];
    const apply = async (configId: string, value: string) => {
      const result = await client.request<{ configOptions: ConfigOption[] }>('session/set_config_option', {
        sessionId: session.sessionId, configId, value,
      });
      options = result.configOptions ?? options;
    };
    const modelChoice = options.find(({ id }) => id === 'model');
    const currentModel = request.model ?? state.defaultModel;
    if (modelChoice && currentModel && currentModel !== modelChoice.currentValue) {
      if (modelChoice.options && !modelChoice.options.some(({ value }) => value === currentModel)) {
        throw new ModelUnavailable(`Antigravity does not offer the model "${currentModel}".`);
      }
      await apply('model', currentModel);
    }
    const model = options.find(({ id }) => id === 'model')?.currentValue;
    const thought = options.find(({ id }) => id === 'thought_level');
    const efforts = (thought?.options ?? []).map(({ value }) => value);
    if (model && thought?.currentValue && !Object.hasOwn(state.defaultEfforts ?? {}, model)) {
      state.defaultEfforts = { ...state.defaultEfforts, [model]: thought.currentValue };
    }
    const baseline = model ? state.defaultEfforts?.[model] : undefined;
    const wanted = request.effort && efforts.includes(request.effort) ? request.effort : baseline;
    if (request.effort && request.effort !== wanted) {
      emit({ type: 'notice', text: `Antigravity model ${model ?? 'Default'} does not offer "${request.effort}" effort. This turn uses its default effort.` });
    }
    if (thought && wanted && efforts.includes(wanted) && wanted !== thought.currentValue) await apply(thought.id, wanted);

    const models = options.find(({ id }) => id === 'model')?.options ?? [];
    const previous = this.#catalog?.cwd === request.cwd ? this.#catalog.value : undefined;
    const catalogModels = models.map(({ value, name }) => {
      const known = previous?.models.find(({ id }) => id === value);
      if (value === model) return { id: value, label: name, efforts, defaultEffort: baseline };
      return { id: value, label: name, efforts: known?.efforts ?? [], effortsUnknown: known?.effortsUnknown ?? !known, defaultEffort: known?.defaultEffort };
    });
    const defaultModel = catalogModels.find(({ id }) => id === state.defaultModel);
    this.#catalog = {
      cwd: request.cwd,
      value: {
        models: catalogModels,
        efforts: [...new Set(catalogModels.flatMap(({ efforts }) => efforts))],
        defaultModel: defaultModel && !defaultModel.effortsUnknown
          ? { label: defaultModel.label, efforts: defaultModel.efforts, effort: defaultModel.defaultEffort } : undefined,
        defaultEffortsUnknown: !defaultModel || defaultModel.effortsUnknown,
      },
    };
    return options;
  }
}
