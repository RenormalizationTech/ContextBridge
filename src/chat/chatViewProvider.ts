import * as vscode from 'vscode';
import type { AttachmentStore } from '../context/attachmentStore.ts';
import { resolveAttachment } from '../context/collect.ts';
import { applyLimits, buildPrompt } from '../context/payload.ts';
import type { Provider } from '../providers/types.ts';
import type { HostMessage, WebviewMessage } from './messages.ts';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'contextBridge.chat';

  private view?: vscode.WebviewView;
  private pending?: AbortController;
  private readonly extensionUri: vscode.Uri;
  private readonly provider: Provider;
  private readonly attachments: AttachmentStore;

  constructor(extensionUri: vscode.Uri, provider: Provider, attachments: AttachmentStore) {
    this.extensionUri = extensionUri;
    this.provider = provider;
    this.attachments = attachments;
    attachments.onDidChange(() => this.postState());
  }

  // Shows the chat view without taking focus from the editor.
  reveal(): void {
    if (this.view) this.view.show(true);
    else void vscode.commands.executeCommand(`${ChatViewProvider.viewId}.focus`);
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const mediaUri = vscode.Uri.joinPath(this.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [mediaUri] };
    view.webview.html = this.renderHtml(view.webview, mediaUri);
    view.webview.onDidReceiveMessage((message: WebviewMessage) => this.handleMessage(message));
    view.onDidDispose(() => {
      this.pending?.abort();
      this.view = undefined;
    });
  }

  private handleMessage(message: WebviewMessage): void {
    switch (message.type) {
      case 'ready':
        this.postState();
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
      case 'removeAttachment':
        this.attachments.remove(message.id);
        break;
      case 'clearAttachments':
        this.attachments.clear();
        break;
    }
  }

  private postState(): void {
    this.post({ type: 'state', provider: this.provider.label, attachments: this.attachments.summaries() });
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
    this.post({ type: 'start', question });
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

  private renderHtml(webview: vscode.Webview, mediaUri: vscode.Uri): string {
    const nonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'main.js'));
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
  <div id="messages" aria-live="polite"></div>
  <form id="composer">
    <div id="attachments"></div>
    <textarea id="question" rows="3" placeholder="Ask about your code (Enter to send, Shift+Enter for a new line)"></textarea>
    <div class="actions">
      <span id="provider"></span>
      <button type="button" id="cancel" hidden>Cancel</button>
      <button type="submit" id="send">Ask</button>
    </div>
  </form>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
