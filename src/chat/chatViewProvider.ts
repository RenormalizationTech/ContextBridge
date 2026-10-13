import * as vscode from 'vscode';
import type { AttachmentStore } from '../context/attachmentStore.ts';
import { resolveAttachment } from '../context/collect.ts';
import { applyLimits, buildPrompt } from '../context/payload.ts';
import type { Provider, ProviderStatus } from '../providers/types.ts';
import type { HostMessage, WebviewMessage } from './messages.ts';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'contextBridge.chat';

  private view?: vscode.WebviewView;
  private pending?: AbortController;
  private providerId: string;
  private readonly statuses = new Map<string, ProviderStatus>();
  private readonly extensionUri: vscode.Uri;
  private readonly providers: readonly Provider[];
  private readonly attachments: AttachmentStore;
  private readonly onProviderSelected: (id: string) => void;

  constructor(
    extensionUri: vscode.Uri,
    providers: readonly Provider[],
    providerId: string,
    attachments: AttachmentStore,
    onProviderSelected: (id: string) => void,
  ) {
    this.extensionUri = extensionUri;
    this.providers = providers;
    this.providerId = providers.some((provider) => provider.id === providerId) ? providerId : providers[0].id;
    this.attachments = attachments;
    this.onProviderSelected = onProviderSelected;
    attachments.onDidChange(() => this.postState());
  }

  private get provider(): Provider {
    return this.providers.find((provider) => provider.id === this.providerId) ?? this.providers[0];
  }

  // Switching providers starts a new conversation; attachments are kept.
  selectProvider(id: string): void {
    if (id === this.providerId || !this.providers.some((provider) => provider.id === id)) return;
    this.pending?.abort();
    this.providerId = id;
    this.onProviderSelected(id);
    this.newChat();
    void this.refreshStatus();
  }

  newChat(): void {
    this.pending?.abort();
    this.provider.resetConversation();
    this.post({ type: 'cleared' });
  }

  async refreshStatus(): Promise<void> {
    const provider = this.provider;
    this.statuses.delete(provider.id);
    this.postState();
    this.statuses.set(provider.id, await provider.checkStatus());
    this.postState();
  }

  // Shows the chat view without taking focus from the editor.
  reveal(): void {
    if (this.view) this.view.show(true);
    else void vscode.commands.executeCommand(`${ChatViewProvider.viewId}.focus`);
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const mediaUri = vscode.Uri.joinPath(this.extensionUri, 'media');
    const distUri = vscode.Uri.joinPath(this.extensionUri, 'dist');
    view.webview.options = { enableScripts: true, localResourceRoots: [mediaUri, distUri] };
    view.webview.html = this.renderHtml(view.webview, mediaUri, distUri);
    view.webview.onDidReceiveMessage((message: WebviewMessage) => this.handleMessage(message));
    view.onDidDispose(() => {
      this.pending?.abort();
      this.view = undefined;
    });
  }

  private handleMessage(message: WebviewMessage): void {
    switch (message.type) {
      case 'ready':
        if (this.statuses.has(this.providerId)) this.postState();
        else void this.refreshStatus();
        break;
      case 'newChat':
        this.newChat();
        break;
      case 'selectProvider':
        this.selectProvider(message.id);
        break;
      case 'ask':
        void this.ask(message.question);
        break;
      case 'cancel':
        this.pending?.abort();
        break;
      case 'openAttachment':
        void this.openAttachment(message.id);
        break;
      case 'openLink':
        void this.openLink(message.href);
        break;
      case 'removeAttachment':
        this.attachments.remove(message.id);
        break;
      case 'clearAttachments':
        this.attachments.clear();
        break;
    }
  }

  private postState(): void {
    this.post({
      type: 'state',
      providers: this.providers.map(({ id, label }) => ({ id, label })),
      providerId: this.providerId,
      status: this.statuses.get(this.providerId),
      attachments: this.attachments.summaries(),
    });
  }

  // Web links open in the browser; relative links open workspace files (optionally `#L12`).
  private async openLink(href: string): Promise<void> {
    if (/^https?:\/\//i.test(href)) {
      await vscode.env.openExternal(vscode.Uri.parse(href));
      return;
    }
    const folder = vscode.workspace.workspaceFolders?.[0];
    const match = href.match(/^([^#]+)(?:#L(\d+))?/);
    if (!folder || !match || /^[a-z][a-z0-9+.-]*:/i.test(href)) return;
    const line = match[2] ? Number(match[2]) - 1 : undefined;
    try {
      await vscode.window.showTextDocument(vscode.Uri.joinPath(folder.uri, decodeURIComponent(match[1])), {
        selection: line === undefined ? undefined : new vscode.Range(line, 0, line, 0),
        preview: true,
      });
    } catch {
      void vscode.window.showWarningMessage(`ContextBridge: could not open ${href}.`);
    }
  }

  private async openAttachment(id: string): Promise<void> {
    const attachment = this.attachments.get(id);
    if (!attachment) return;
    const selection = attachment.kind === 'selection'
      ? new vscode.Range(attachment.range.start - 1, 0, attachment.range.end - 1, Number.MAX_SAFE_INTEGER)
      : undefined;
    try {
      await vscode.window.showTextDocument(vscode.Uri.parse(attachment.uri), { selection, preview: true });
    } catch {
      void vscode.window.showWarningMessage(`ContextBridge: could not open ${attachment.path}.`);
    }
  }

  private async ask(question: string): Promise<void> {
    if (this.pending) return;
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) {
      this.post({ type: 'error', message: 'Open a folder to ask questions about it.' });
      return;
    }
    const controller = new AbortController();
    this.pending = controller;
    const sent = this.attachments.summaries().map((item) => (item.range ? `${item.path}:${item.range.start}-${item.range.end}` : item.path));
    this.post({ type: 'start', question, attachments: sent });
    try {
      const resolved = applyLimits(await Promise.all(this.attachments.items.map(resolveAttachment)));
      for (const attachment of resolved) {
        if (attachment.omitted !== undefined) {
          this.post({ type: 'notice', text: `${attachment.path}: content not sent (${attachment.omitted}); sent as a reference only.` });
        }
      }
      await this.provider.ask(
        { prompt: buildPrompt(resolved, question), cwd },
        (event) => this.post(event),
        controller.signal,
      );
    } catch (error) {
      this.post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      this.pending = undefined;
    }
  }

  private post(message: HostMessage): void {
    void this.view?.webview.postMessage(message);
  }

  private renderHtml(webview: vscode.Webview, mediaUri: vscode.Uri, distUri: vscode.Uri): string {
    const nonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'webview.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'main.css'));
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>ContextBridge</title>
</head>
<body>
  <header>
    <div class="toolbar">
      <select id="provider" aria-label="Provider"></select>
      <button type="button" id="new-chat" class="secondary">New chat</button>
    </div>
    <div id="status" class="muted"></div>
  </header>
  <div id="messages" aria-live="polite"></div>
  <form id="composer">
    <div id="attachments"></div>
    <textarea id="question" rows="3" placeholder="Ask about your code (Enter to send, Shift+Enter for a new line)"></textarea>
    <div class="actions">
      <span class="spacer"></span>
      <button type="button" id="cancel" hidden>Cancel</button>
      <button type="submit" id="send">Ask</button>
    </div>
  </form>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
