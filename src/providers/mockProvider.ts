import type { ModelCatalog, Provider, ProviderEvent, ProviderRequest, ProviderStatus } from './types.ts';

// Streams a canned answer so the editor workflow can be developed without a live account.
export class MockProvider implements Provider {
  readonly id = 'mock';
  readonly label = 'Mock';
  readonly streamsTokens = true;

  private readonly delayMs: number;

  constructor(delayMs = 40) {
    this.delayMs = delayMs;
  }

  async ask(request: ProviderRequest, onEvent: (event: ProviderEvent) => void, signal: AbortSignal): Promise<void> {
    const attachmentCount = (request.prompt.match(/<attachment /g) ?? []).length;
    const question = request.prompt.slice(request.prompt.lastIndexOf('Question: ') + 'Question: '.length);
    const answer =
      `This is a mock answer from ContextBridge. You asked: "${question}". ` +
      `The request included ${attachmentCount} attachment(s) and would run in ${request.cwd}. ` +
      'A real provider would stream its explanation here, word by word, without modifying any files.';

    for (const word of answer.split(/(?<= )/)) {
      if (signal.aborted) {
        onEvent({ type: 'done', cancelled: true });
        return;
      }
      onEvent({ type: 'text', text: word });
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    onEvent({ type: 'done', cancelled: signal.aborted });
  }

  resetConversation(): void {}

  readonly conversationId = undefined;

  restoreConversation(): void {}

  async listModels(_cwd: string): Promise<ModelCatalog | undefined> {
    return undefined;
  }

  async checkStatus(): Promise<ProviderStatus> {
    return { ok: true, installed: true, detail: 'Canned answers for development' };
  }
}
