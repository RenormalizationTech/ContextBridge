import { CopilotClient, RuntimeConnection, type CopilotSession, type ModelInfo, type PermissionRequest as CopilotPermission, type SessionConfig } from '@github/copilot-sdk';
import { GIT_TOOLS, gitArgs, gitCommandLine } from '../git/gitTools.ts';
import { readGit } from '../git/workspaceChanges.ts';
import { childEnv, findExecutable } from './process.ts';
import type { ModelCatalog, PermissionRequest, Provider, ProviderEvent, ProviderRequest, ProviderStatus } from './types.ts';

const NOT_FOUND = 'Copilot CLI not found. Install it, or set "contextBridge.copilot.path" to the copilot executable.';
// Built-in edits, shell, task/subagent and management tools stay unavailable. MCP integrations
// retain their own access, as with the other providers (documented accepted limitation).
export const COPILOT_ASK_TOOLS = ['builtin:view', 'builtin:grep', 'builtin:rg', 'builtin:glob', 'builtin:web_fetch', 'builtin:web_search', 'mcp:*', ...GIT_TOOLS.map(tool => `custom:${tool.name}`)];
export type CopilotClientFactory = (path: string, cwd: string, env: NodeJS.ProcessEnv) => CopilotClient;
const createClient: CopilotClientFactory = (path, cwd, env) => new CopilotClient({
  connection: RuntimeConnection.forStdio({ path }), workingDirectory: cwd, env, logLevel: 'error',
});

export function copilotModels(models: ModelInfo[]): ModelCatalog {
  const options = models.filter(model => model.policy?.state !== 'disabled').map(model => ({
    id: model.id, label: model.name, efforts: model.supportedReasoningEfforts ?? [], defaultEffort: model.defaultReasoningEffort,
  }));
  // The SDK doesn't expose the configured default until the first prompt initializes the model.
  return { models: options, efforts: [], defaultEffortsUnknown: true };
}

export function copilotPermission(request: CopilotPermission): PermissionRequest {
  const requireUser = request.managedApprovalRequired === true;
  switch (request.kind) {
    case 'write':
      return { tool: 'Edit file', detail: request.fileName, preview: request.diff || request.newFileContents, requireUser,
        always: requireUser ? undefined : { key: 'edits', label: 'All file edits in this chat' } };
    case 'shell':
      return { tool: request.requestSandboxBypass ? 'Run command outside sandbox' : 'Run command', detail: request.fullCommandText, requireUser,
        always: requireUser ? undefined : { key: `shell:${request.fullCommandText}`, label: 'This exact command in this chat' } };
    case 'read': return { tool: 'Read file', detail: request.path, requireUser };
    case 'url': return { tool: 'Access URL', detail: request.url, requireUser };
    case 'mcp': return { tool: `${request.serverName}: ${request.toolName}`, detail: request.toolTitle, requireUser,
      always: requireUser ? undefined : { key: `mcp:${request.serverName}:${request.toolName}`, label: 'This tool in this chat' } };
    default: return { tool: request.kind, detail: 'Copilot requests permission for this action.', requireUser };
  }
}

// Bounds startup/catalog reads; turn work has a longer limit and can always be cancelled.
async function timed<T>(work: Promise<T>, milliseconds = 15000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Copilot CLI did not respond in time.')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

export class CopilotProvider implements Provider {
  readonly id = 'copilot';
  readonly label = 'GitHub Copilot';
  readonly streamsTokens = true;
  private sessionId?: string;
  private readonly configuredPath: () => string | undefined;
  private readonly factory: CopilotClientFactory;

  constructor(configuredPath: () => string | undefined, factory: CopilotClientFactory = createClient) {
    this.configuredPath = configuredPath;
    this.factory = factory;
  }
  get conversationId(): string | undefined { return this.sessionId; }
  resetConversation(): void { this.sessionId = undefined; }
  restoreConversation(id: string | undefined): void { this.sessionId = id; }

  private async client(cwd: string): Promise<CopilotClient | undefined> {
    const executable = await findExecutable('copilot', this.configuredPath());
    return executable ? this.factory(executable, cwd, await childEnv()) : undefined;
  }

  async checkStatus(): Promise<ProviderStatus> {
    const client = await this.client(process.cwd());
    if (!client) return { ok: false, installed: false, detail: NOT_FOUND };
    try {
      await timed(client.start());
      const auth = await timed(client.getAuthStatus());
      return { ok: auth.isAuthenticated, installed: true, detail: auth.isAuthenticated ? 'Copilot CLI ready' : 'Run copilot login in a terminal, then select Copilot again.' };
    } catch (error) {
      return { ok: false, installed: true, detail: `Copilot: ${(error as Error).message}` };
    } finally { await client.stop().catch(() => client.forceStop()); }
  }

  async listModels(cwd: string): Promise<ModelCatalog | undefined> {
    const client = await this.client(cwd);
    if (!client) return undefined;
    try {
      await timed(client.start());
      return copilotModels(await timed(client.listModels(), 30000));
    } catch { return undefined; }
    finally { await client.stop().catch(() => client.forceStop()); }
  }

  async ask(request: ProviderRequest, onEvent: (event: ProviderEvent) => void, signal: AbortSignal): Promise<void> {
    let terminal = false;
    const emit = (event: ProviderEvent) => {
      if (terminal) return;
      if (event.type === 'done' || event.type === 'error') terminal = true;
      onEvent(event);
    };
    const client = await this.client(request.cwd);
    if (signal.aborted) { emit({ type: 'done', cancelled: true }); return; }
    if (!client) { emit({ type: 'error', message: NOT_FOUND }); return; }
    let session: CopilotSession | undefined;
    let unsubscribe: (() => void) | undefined;
    let cancel!: () => void;
    const cancelled = new Promise<undefined>(resolve => { cancel = () => resolve(undefined); });
    const onAbort = () => {
      emit({ type: 'done', cancelled: true });
      cancel();
      void session?.abort().catch(() => {});
      void client.forceStop().catch(() => {});
    };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      await timed(client.start());
      if (signal.aborted) return;
      const config: SessionConfig = {
        model: request.model, reasoningEffort: request.effort as SessionConfig['reasoningEffort'],
        workingDirectory: request.cwd, streaming: true, enableConfigDiscovery: true,
        availableTools: request.mode === 'ask' ? COPILOT_ASK_TOOLS : undefined,
        tools: request.mode === 'ask' ? GIT_TOOLS.map(tool => ({
          name: tool.name, description: tool.description, parameters: tool.inputSchema,
          handler: async (args: Record<string, unknown>) => {
            const output = await readGit(request.cwd, gitArgs(tool.name, args));
            return output.length > 200 * 1024 ? `${output.slice(0, 200 * 1024)}\n… output truncated` : output || '(no output)';
          },
        })) : undefined,
        onPermissionRequest: async permission => {
          if (signal.aborted) return { kind: 'reject' };
          const readOnly = permission.kind === 'read' || permission.kind === 'url';
          if (request.mode === 'ask') {
            if (permission.managedApprovalRequired) return { kind: 'reject' };
            // Tool filtering is the boundary even when integrations/trusted rules approve actions.
            return readOnly || permission.kind === 'mcp' || (permission.kind === 'custom-tool' && GIT_TOOLS.some(tool => tool.name === permission.toolName))
              ? { kind: 'approve-once' } : { kind: 'reject' };
          }
          if (readOnly && !permission.managedApprovalRequired) return { kind: 'approve-once' };
          const allowed = await request.requestPermission(copilotPermission(permission));
          return allowed && !signal.aborted
            ? { kind: 'approve-once', approvedInteractively: permission.managedApprovalRequired || undefined }
            : { kind: 'reject', feedback: 'The user denied this action. Answer without performing it.' };
        },
      };
      session = this.sessionId ? await client.resumeSession(this.sessionId, config) : await client.createSession(config);
      this.sessionId = session.sessionId;
      if (signal.aborted) return;
      const streamed = new Set<string>();
      const completed = new Set<string>();
      let textReceived = false;
      unsubscribe = session.on(event => {
        if (event.agentId || ('parentToolCallId' in event.data && event.data.parentToolCallId)) return;
        if (event.type === 'assistant.message_delta') {
          streamed.add(event.data.messageId);
          textReceived ||= !!event.data.deltaContent;
          emit({ type: 'text', text: event.data.deltaContent });
        } else if (event.type === 'assistant.message') {
          completed.add(event.data.messageId);
          if (!streamed.has(event.data.messageId)) {
            textReceived ||= !!event.data.content;
            emit({ type: 'text', text: event.data.content });
          }
        } else if (event.type === 'tool.execution_start') {
          const args = event.data.arguments;
          const input = args && typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : {};
          emit({ type: 'tool', name: GIT_TOOLS.some(tool => tool.name === event.data.toolName) ? gitCommandLine(event.data.toolName, input) : event.data.toolName,
            detail: String(input.path ?? input.command ?? input.pattern ?? '').slice(0, 180) });
        }
      });
      const reply = await Promise.race([session.sendAndWait({ prompt: request.prompt }, 30 * 60 * 1000), cancelled]);
      if (signal.aborted) return;
      if (reply && !streamed.has(reply.data.messageId) && !completed.has(reply.data.messageId)) {
        textReceived ||= !!reply.data.content;
        emit({ type: 'text', text: reply.data.content });
      }
      try {
        const current = await timed(session.rpc.model.getCurrent(), 5000);
        if (current.modelId) emit({ type: 'model', model: current.modelId, effort: current.reasoningEffort,
          effortConfirmed: current.reasoningEffort !== undefined || request.effort === undefined });
      } catch { /* Older runtime may not expose model metadata. */ }
      emit(textReceived ? { type: 'done', cancelled: false } : { type: 'error', message: 'Copilot ended the turn without an answer. Try again or start a new chat.' });
    } catch (error) {
      const message = (error as Error).message;
      if (this.sessionId && /session.*(not found|does not exist|missing)/i.test(message)) this.sessionId = undefined;
      emit(signal.aborted ? { type: 'done', cancelled: true } : { type: 'error', message: `Copilot: ${message}`,
        modelUnavailable: /model.*(not found|unsupported|not supported|not available|invalid)/i.test(message) || undefined });
    } finally {
      signal.removeEventListener('abort', onAbort);
      unsubscribe?.();
      await client.stop().catch(() => client.forceStop());
    }
  }
}
