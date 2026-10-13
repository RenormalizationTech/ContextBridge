export interface ProviderRequest {
  prompt: string;
  // Workspace folder the provider process runs in.
  cwd: string;
}

export type ProviderEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; detail: string }
  | { type: 'done'; cancelled: boolean }
  | { type: 'error'; message: string };

export interface Provider {
  readonly id: string;
  readonly label: string;
  // False when the provider only delivers whole messages (Codex `exec --json`).
  readonly streamsTokens: boolean;
  // Resolves after emitting exactly one terminal event ('done' or 'error').
  ask(request: ProviderRequest, onEvent: (event: ProviderEvent) => void, signal: AbortSignal): Promise<void>;
}
