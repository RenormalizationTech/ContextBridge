// Ask: answers only, enforced through provider configuration. Agent: the provider's full
// capabilities; Claude Code asks the user before edits and commands, Codex is sandboxed to the workspace.
export type Mode = 'ask' | 'agent';

// Agent mode only, like Copilot's permissions picker. Default: the user approves each action the
// CLI asks about. Bypass: every approval is granted automatically (still shown in the chat).
export type PermissionLevel = 'default' | 'bypass';

// A tool call the provider wants the user to approve (Agent mode, Claude Code).
export interface PermissionRequest {
  tool: string;
  // Managed provider policy can require a human response even under Bypass/Always allow.
  requireUser?: boolean;
  // One-line summary, e.g. the command or file path.
  detail: string;
  // Optional longer preview, e.g. the text an edit replaces and inserts.
  preview?: string;
  // Identifies "the same kind of action" for an "Always allow" choice that lasts for the rest of the
  // chat (e.g. all file edits, or one exact command), with a description of that scope.
  always?: { key: string; label: string };
}

export interface ProviderRequest {
  prompt: string;
  // Workspace folder the provider process runs in.
  cwd: string;
  mode: Mode;
  // Model and reasoning effort for this question. Undefined: the CLI's own default (user config).
  model?: string;
  effort?: string;
  // Resolves true to allow. Used in Agent mode; must resolve false when the request is cancelled.
  requestPermission: (request: PermissionRequest) => Promise<boolean>;
}

export type ProviderEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; detail: string }
  // The model the CLI is using, shown in the answer footer. effortConfirmed: the CLI reported
  // the effort it applies (undefined effort then means the model has no effort levels).
  | { type: 'model'; model: string; effort?: string; effortConfirmed?: boolean }
  | { type: 'done'; cancelled: boolean }
  // modelUnavailable: the chosen model doesn't exist or the account can't use it.
  | { type: 'error'; message: string; modelUnavailable?: boolean };

// A model the user can pick, with the reasoning effort levels it supports (empty: none).
export interface ModelOption {
  id: string;
  label: string;
  efforts: string[];
  // The effort used when none is chosen, when the CLI lists it.
  defaultEffort?: string;
  // The model id the CLI reports for this choice (an alias resolves to a full id).
  resolvesTo?: string;
}

// What the model and effort pickers offer for a provider. Read from the CLI, so new models
// appear without an extension update.
export interface ModelCatalog {
  models: ModelOption[];
  // Effort levels offered for a typed-in model the CLI doesn't list.
  efforts: string[];
  // No default-effort metadata yet; choose a listed model before selecting an effort.
  defaultEffortsUnknown?: boolean;
  // What "Default" currently means: the CLI's default, after the user's own CLI config.
  defaultModel?: { label: string; efforts: string[]; effort?: string };
}

export interface ProviderStatus {
  ok: boolean;
  // False when the CLI executable wasn't found (as opposed to installed but logged out).
  installed: boolean;
  detail: string;
}

export interface Provider {
  readonly id: string;
  readonly label: string;
  // False when the provider only delivers whole messages (Codex `exec --json`).
  readonly streamsTokens: boolean;
  // Resolves after emitting exactly one terminal event ('done' or 'error').
  // Follow-up questions continue the provider's conversation until resetConversation().
  ask(request: ProviderRequest, onEvent: (event: ProviderEvent) => void, signal: AbortSignal): Promise<void>;
  resetConversation(): void;
  // The CLI's conversation id (Claude session / Codex thread), saved with chat history so a
  // reopened chat continues the same CLI conversation.
  readonly conversationId: string | undefined;
  restoreConversation(id: string | undefined): void;
  // Models and effort levels the CLI offers, with its defaults as seen from `cwd` (project config
  // can change them). Undefined when it has no model choice (mock) or the list can't be read.
  listModels(cwd: string): Promise<ModelCatalog | undefined>;
  // The effort used for `model` when none is chosen, for CLIs whose list doesn't include it.
  defaultEffort?(model: string, cwd: string): Promise<string | undefined>;
  // Whether the CLI is installed and logged in.
  checkStatus(): Promise<ProviderStatus>;
}
