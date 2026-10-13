// Ask: answers only, enforced through provider configuration. Agent: the provider's full
// capabilities; Claude Code asks the user before edits and commands, Codex is sandboxed to the workspace.
export type Mode = 'ask' | 'agent';

// Agent mode only, like Copilot's permissions picker. Default: the user approves each action the
// CLI asks about. Bypass: every approval is granted automatically (still shown in the chat).
export type PermissionLevel = 'default' | 'bypass';

// A tool call the provider wants the user to approve (Agent mode, Claude Code).
export interface PermissionRequest {
  tool: string;
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
  // Resolves true to allow. Used in Agent mode; must resolve false when the request is cancelled.
  requestPermission: (request: PermissionRequest) => Promise<boolean>;
}

export type ProviderEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; detail: string }
  | { type: 'done'; cancelled: boolean }
  | { type: 'error'; message: string };

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
  // Whether the CLI is installed and logged in.
  checkStatus(): Promise<ProviderStatus>;
}
