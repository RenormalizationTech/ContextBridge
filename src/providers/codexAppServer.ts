import { spawn } from 'node:child_process';
import { withLoginHint } from './claudeStream.ts';
import { CodexAppServerParser } from './codexAppServerStream.ts';
import { unwrapShell } from './codexStream.ts';
import { captureStderr, childEnv, readLines } from './process.ts';
import type { CodexWebSearch } from './codexProvider.ts';
import type { ModelCatalog, ProviderEvent, ProviderRequest } from './types.ts';

// Thread settings per mode. Ask: read-only sandbox, and the model can never ask for more.
// Agent: still read-only by default, but Codex may request escalation, which the user approves
// or denies in the chat (owner decision, matching Claude Code's Agent mode).
const THREAD_SETTINGS = {
  ask: { sandbox: 'read-only', approvalPolicy: 'never' },
  agent: { sandbox: 'read-only', approvalPolicy: 'on-request' },
} as const;

// Runs one question over `codex app-server` (JSON-RPC over stdio): starts or resumes the thread,
// starts a turn, streams events until the turn completes, then stops the server.
// Resolves with the thread id for follow-ups.
export async function runAppServerTurn(
  executable: string,
  request: ProviderRequest,
  webSearch: CodexWebSearch,
  threadId: string | undefined,
  onEvent: (event: ProviderEvent) => void,
  signal: AbortSignal,
): Promise<string | undefined> {
  const child = spawn(executable, ['app-server', '--stdio'], { cwd: request.cwd, env: await childEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
  const stderr = captureStderr(child);
  const parser = new CodexAppServerParser();
  // Web search is set explicitly so it doesn't depend on Codex's built-in default.
  const settings = { ...THREAD_SETTINGS[request.mode], config: { web_search: webSearch } };
  let terminal = false;
  let nextId = 1;
  const pending = new Map<number, { resolve: (result: any) => void; reject: (error: Error) => void }>();

  const emit = (event: ProviderEvent) => {
    if (terminal) return;
    if (event.type === 'done' || event.type === 'error') terminal = true;
    onEvent(event);
  };
  const send = (message: unknown) => {
    if (child.stdin.writable) child.stdin.write(`${JSON.stringify(message)}\n`);
  };
  const call = (method: string, params: unknown) =>
    new Promise<any>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      send({ id, method, params });
    });

  const onAbort = () => {
    emit({ type: 'done', cancelled: true });
    if (threadId && parser.turnId) send({ id: nextId++, method: 'turn/interrupt', params: { threadId, turnId: parser.turnId } });
    // Give Codex a moment to record the interruption, then stop it.
    setTimeout(() => child.kill('SIGTERM'), 500);
  };
  signal.addEventListener('abort', onAbort, { once: true });

  readLines(child, (line) => {
    let message: any;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id !== undefined && message.method === undefined) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiter?.reject(new Error(message.error.message ?? 'Codex request failed'));
      else waiter?.resolve(message.result);
      return;
    }
    if (message.id !== undefined) {
      void answerServerRequest(message.id, message.method, message.params ?? {});
      return;
    }
    if (signal.aborted) return;
    for (const event of parser.handle(message.method, message.params ?? {})) emit(event);
    if (parser.finished) {
      child.stdin.end();
      setTimeout(() => child.kill('SIGTERM'), 200);
    }
  });

  // Approval requests from Codex. Ask mode never requests them (approval policy "never"), but any
  // that arrive are declined. In Agent mode the user decides.
  async function answerServerRequest(id: number, method: string, params: any): Promise<void> {
    const decide = async (tool: string, detail: string, preview?: string) =>
      request.mode === 'agent' && !signal.aborted && (await request.requestPermission({ tool, detail, preview, always: alwaysScope(tool, detail) }));
    switch (method) {
      case 'item/commandExecution/requestApproval': {
        const allowed = await decide('Shell command', unwrapShell(params.command ?? ''), params.reason ?? undefined);
        send({ id, result: { decision: allowed ? 'accept' : 'decline' } });
        return;
      }
      case 'item/fileChange/requestApproval': {
        const allowed = await decide('File change', parser.filesFor(params.itemId).join(', ') || 'files in the workspace', params.reason ?? undefined);
        send({ id, result: { decision: allowed ? 'accept' : 'decline' } });
        return;
      }
      case 'execCommandApproval': {
        const allowed = await decide('Shell command', [].concat(params.command ?? []).join(' '), params.reason ?? undefined);
        send({ id, result: { decision: allowed ? 'approved' : 'denied' } });
        return;
      }
      case 'applyPatchApproval': {
        const allowed = await decide('File change', Object.keys(params.fileChanges ?? {}).join(', '), params.reason ?? undefined);
        send({ id, result: { decision: allowed ? 'approved' : 'denied' } });
        return;
      }
      default:
        // Other requests (extra permission profiles, user-input prompts, MCP elicitation, ...) are
        // not supported in the chat UI yet.
        send({ id, error: { code: -32601, message: `ContextBridge does not support ${method}` } });
    }
  }

  const finished = new Promise<void>((resolve) => {
    child.on('error', (error) => {
      emit({ type: 'error', message: `Could not start Codex: ${error.message}` });
      resolve();
    });
    child.on('close', (code) => {
      signal.removeEventListener('abort', onAbort);
      for (const waiter of pending.values()) waiter.reject(new Error('Codex app server stopped'));
      if (!terminal) {
        const detail = parser.lastError || stderr().split('\n').filter((line) => !/^\S*\d{4}-\d\d-\d\dT/.test(line)).slice(-5).join('\n') || `exit code ${code}`;
        emit({ type: 'error', message: withLoginHint(`Codex exited before answering: ${detail}`) });
      }
      resolve();
    });
  });

  try {
    await call('initialize', {
      clientInfo: { name: 'contextbridge', title: 'ContextBridge', version: '0.1.0' },
      capabilities: { experimentalApi: false, requestAttestation: false },
    });
    send({ method: 'initialized' });
    // Unset model and effort leave the user's Codex config in charge. Both also apply on resume.
    const model = request.model ? { model: request.model } : {};
    const thread = threadId
      ? await call('thread/resume', { threadId, cwd: request.cwd, ...settings, ...model })
      : await call('thread/start', { cwd: request.cwd, ...settings, ...model });
    threadId = thread.thread.id;
    if (typeof thread.model === 'string') emit({ type: 'model', model: thread.model, effort: request.effort ?? thread.reasoningEffort ?? undefined });
    if (signal.aborted) throw new Error('cancelled');
    const effort = request.effort ? { effort: request.effort } : {};
    const turn = await call('turn/start', { threadId, ...model, ...effort, input: [{ type: 'text', text: request.prompt, text_elements: [] }] });
    parser.turnId ??= turn.turn?.id;
  } catch (error) {
    if (!signal.aborted) emit({ type: 'error', message: withLoginHint(`Codex: ${error instanceof Error ? error.message : String(error)}`) });
    child.kill('SIGTERM');
  }
  await finished;
  return threadId;
}

// The models this Codex account can use, from the app server's `model/list`, with the effort
// levels each supports, and what "Default" means: the model and effort in the user's Codex config
// as seen from `cwd` (`config/read`), else the catalog's default model and its default effort.
export async function listAppServerModels(executable: string, cwd: string, timeoutMs = 15000): Promise<ModelCatalog | undefined> {
  const child = spawn(executable, ['app-server', '--stdio'], { cwd, env: await childEnv(), stdio: ['pipe', 'pipe', 'ignore'] });
  const send = (message: unknown) => {
    if (child.stdin.writable) child.stdin.write(`${JSON.stringify(message)}\n`);
  };
  const models: any[] = [];
  let config: any;
  const result = new Promise<ModelCatalog | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), timeoutMs);
    const finish = (catalog: ModelCatalog | undefined) => {
      clearTimeout(timer);
      resolve(catalog);
    };
    child.on('error', () => finish(undefined));
    child.on('close', () => finish(undefined));
    readLines(child, (line) => {
      let message: any;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.id === 1) {
        send({ method: 'initialized' });
        send({ id: 'config', method: 'config/read', params: { cwd } });
      } else if (message.id === 'config') {
        // Without the config, Default still shows the catalog's default.
        config = message.result?.config ?? {};
        send({ id: 2, method: 'model/list', params: {} });
      } else if (typeof message.id === 'number' && message.id >= 2 && message.method === undefined) {
        if (message.error) return finish(undefined);
        models.push(...(message.result?.data ?? []));
        // Large catalogs come in pages.
        if (message.result?.nextCursor) send({ id: message.id + 1, method: 'model/list', params: { cursor: message.result.nextCursor } });
        else finish(codexCatalog(models, config));
      }
    });
  });
  send({
    id: 1,
    method: 'initialize',
    params: { clientInfo: { name: 'contextbridge', title: 'ContextBridge', version: '0.1.0' }, capabilities: { experimentalApi: false, requestAttestation: false } },
  });
  const catalog = await result;
  child.kill('SIGTERM');
  return catalog;
}

export function codexCatalog(models: any[], config: any): ModelCatalog {
  const listed = models.filter((model) => !model.hidden && typeof model.model === 'string');
  // The user's configured effort applies to any model that supports it.
  const configEffort: string | undefined = config?.model_reasoning_effort ?? undefined;
  const options = listed.map((model) => {
    const efforts = (model.supportedReasoningEfforts ?? []).map((option: any) => option.reasoningEffort).filter(Boolean) as string[];
    const defaultEffort = configEffort && efforts.includes(configEffort) ? configEffort : model.defaultReasoningEffort ?? undefined;
    return { id: model.model as string, label: (model.displayName as string) || model.model, efforts, defaultEffort };
  });
  const configModel: string | undefined = config?.model ?? undefined;
  const fallbackId = configModel ?? listed.find((model) => model.isDefault)?.model;
  const fallback = options.find((option) => option.id === fallbackId);
  return {
    models: options,
    efforts: [...new Set(options.flatMap((option) => option.efforts))],
    defaultModel: fallbackId
      ? { label: fallback?.label ?? fallbackId, efforts: fallback?.efforts ?? [], effort: fallback ? fallback.defaultEffort : configEffort }
      : undefined,
  };
}

// What "Always allow" covers: all file changes, or one exact command.
function alwaysScope(tool: string, detail: string): { key: string; label: string } {
  return tool === 'File change'
    ? { key: 'edits', label: 'Allow all file changes for the rest of this chat' }
    : { key: `command:${detail}`, label: 'Allow this exact command for the rest of this chat' };
}
