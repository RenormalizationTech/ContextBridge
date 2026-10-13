import * as vscode from 'vscode';
import type { AttachmentStore } from '../context/attachmentStore.ts';
import { resolveAttachment } from '../context/collect.ts';
import { applyLimits, buildPrompt } from '../context/payload.ts';
import type { Mode, PermissionRequest, Provider, ProviderStatus } from '../providers/types.ts';
import { Conversation, isTranscriptMessage } from './conversation.ts';
import type { HistoryStore } from './historyStore.ts';
import type { HostMessage, WebviewMessage } from './messages.ts';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'contextBridge.chat';

  private view?: vscode.WebviewView;
  private pending?: AbortController;
  private providerId: string;
  private mode: Mode;
  private nextPermissionId = 1;
  private readonly permissions = new Map<string, (allow: boolean) => void>();
  private readonly statuses = new Map<string, ProviderStatus>();
  private readonly extensionUri: vscode.Uri;
  private readonly providers: readonly Provider[];
  private readonly attachments: AttachmentStore;
  private readonly onProviderSelected: (id: string) => void;
  private readonly onModeSelected: (mode: Mode) => void;
  private readonly history: HistoryStore;
  private readonly maxChats: () => number;
  // The chat shown in the view. Its transcript outlives the webview, which VS Code discards
  // whenever the view is hidden (e.g. when switching to another side bar view).
  private conversation: Conversation;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private checkedInstalledProvider = false;

  constructor(options: {
    extensionUri: vscode.Uri;
    providers: readonly Provider[];
    providerId: string;
    mode: Mode;
    attachments: AttachmentStore;
    history: HistoryStore;
    maxChats: () => number;
    onProviderSelected: (id: string) => void;
    onModeSelected: (mode: Mode) => void;
  }) {
    this.extensionUri = options.extensionUri;
    this.providers = options.providers;
    this.providerId = this.providers.some((provider) => provider.id === options.providerId) ? options.providerId : this.providers[0].id;
    this.mode = options.mode;
    this.attachments = options.attachments;
    this.history = options.history;
    this.maxChats = options.maxChats;
    this.onProviderSelected = options.onProviderSelected;
    this.onModeSelected = options.onModeSelected;
    this.conversation = new Conversation({ providerId: this.providerId });
    this.attachments.onDidChange(() => this.postState());
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

  // Switching modes keeps the conversation; the next question runs with the new mode's permissions.
  selectMode(mode: Mode): void {
    if (mode === this.mode || (mode !== 'ask' && mode !== 'agent')) return;
    this.mode = mode;
    this.onModeSelected(mode);
    this.postState();
  }

  newChat(): void {
    this.pending?.abort();
    void this.saveNow();
    this.conversation = new Conversation({ providerId: this.providerId });
    this.provider.resetConversation();
    this.post({ type: 'cleared' });
  }

  async showHistory(): Promise<void> {
    await this.saveNow();
    const summaries = await this.history.list();
    const labels = new Map(this.providers.map((provider) => [provider.id, provider.label]));
    const remove = { iconPath: new vscode.ThemeIcon('trash'), tooltip: 'Delete chat' };
    type Item = vscode.QuickPickItem & { id: string };
    const toItems = (list: typeof summaries): Item[] => list.map((summary) => ({
      id: summary.id,
      label: summary.title,
      description: `${labels.get(summary.providerId) ?? summary.providerId} · ${relativeTime(summary.updatedAt)}${summary.id === this.conversation.id ? ' · current' : ''}`,
      buttons: [remove],
    }));
    const pick = vscode.window.createQuickPick<Item>();
    pick.title = 'ContextBridge Chat History';
    pick.placeholder = summaries.length ? 'Open a previous chat' : 'No saved chats in this workspace yet';
    pick.matchOnDescription = true;
    pick.items = toItems(summaries);
    pick.onDidTriggerItemButton(async ({ item }) => {
      await this.history.delete(item.id);
      pick.items = pick.items.filter((other) => other.id !== item.id);
      if (item.id === this.conversation.id) this.newChat();
    });
    pick.onDidAccept(async () => {
      const id = pick.selectedItems[0]?.id;
      pick.hide();
      if (id) await this.openConversation(id);
    });
    pick.onDidHide(() => pick.dispose());
    pick.show();
  }

  async clearHistory(): Promise<void> {
    const confirmed = await vscode.window.showWarningMessage(
      'Delete all saved ContextBridge chats for this workspace?',
      { modal: true, detail: 'Conversations stored by the Claude Code and Codex CLIs themselves are not affected.' },
      'Delete All',
    );
    if (confirmed !== 'Delete All') return;
    this.newChat();
    await this.history.clear();
  }

  // Shows a saved chat and reconnects to its CLI conversation so follow-ups continue it.
  private async openConversation(id: string): Promise<void> {
    if (id === this.conversation.id) return;
    const stored = await this.history.load(id);
    if (!stored) {
      void vscode.window.showWarningMessage('ContextBridge: that chat could not be loaded.');
      return;
    }
    this.pending?.abort();
    await this.saveNow();
    if (stored.providerId !== this.providerId && this.providers.some((provider) => provider.id === stored.providerId)) {
      this.providerId = stored.providerId;
      this.onProviderSelected(stored.providerId);
      void this.refreshStatus();
    }
    this.conversation = new Conversation(stored);
    this.provider.restoreConversation(stored.providerConversationId);
    this.post({ type: 'restore', messages: this.conversation.messages });
    this.reveal();
  }

  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.saveNow(), 500);
  }

  private async saveNow(): Promise<void> {
    clearTimeout(this.saveTimer);
    const conversation = this.conversation;
    if (conversation.isEmpty || this.maxChats() <= 0) return;
    try {
      await this.history.save(conversation.toJSON());
      await this.history.prune(this.maxChats());
    } catch (error) {
      console.error('ContextBridge: could not save chat history', error);
    }
  }

  async refreshStatus(): Promise<void> {
    const provider = this.provider;
    this.statuses.delete(provider.id);
    this.postState();
    this.statuses.set(provider.id, await provider.checkStatus());
    this.postState();
  }

  // Once per session: if the saved provider's CLI isn't installed, switch to one that is, so a
  // user with only one CLI doesn't start on a "not found" error. Mock is never chosen automatically.
  private async selectInstalledProvider(): Promise<void> {
    if (this.checkedInstalledProvider) return;
    this.checkedInstalledProvider = true;
    const current = this.provider;
    if (this.statuses.get(current.id)?.installed !== false || this.pending || !this.conversation.isEmpty) return;
    for (const candidate of this.providers) {
      if (candidate.id === current.id || candidate.id === 'mock') continue;
      const status = await candidate.checkStatus();
      if (!status.installed) continue;
      // The user may have picked a provider while we were checking.
      if (this.provider !== current || this.pending || !this.conversation.isEmpty) return;
      this.statuses.set(candidate.id, status);
      this.selectProvider(candidate.id);
      void vscode.window.showInformationMessage(`ContextBridge: ${current.label} isn't installed, so it switched to ${candidate.label}.`);
      return;
    }
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
    // A running answer keeps going while the view is hidden; it is replayed when the view returns.
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined;
    });
  }

  private handleMessage(message: WebviewMessage): void {
    switch (message.type) {
      case 'ready':
        if (this.statuses.has(this.providerId)) this.postState();
        else void this.refreshStatus().then(() => this.selectInstalledProvider());
        this.post({ type: 'restore', messages: this.conversation.messages });
        break;
      case 'showHistory':
        void this.showHistory();
        break;
      case 'newChat':
        this.newChat();
        break;
      case 'selectProvider':
        this.selectProvider(message.id);
        break;
      case 'selectMode':
        this.selectMode(message.mode);
        break;
      case 'permissionResponse':
        this.resolvePermission(message.id, message.allow);
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
      mode: this.mode,
      status: this.statuses.get(this.providerId),
      attachments: this.attachments.summaries(),
    });
  }

  private requestPermission(request: PermissionRequest, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false);
    const id = String(this.nextPermissionId++);
    return new Promise((resolve) => {
      this.permissions.set(id, resolve);
      signal.addEventListener('abort', () => this.resolvePermission(id, false), { once: true });
      this.post({ type: 'permission', id, ...request });
      this.reveal();
    });
  }

  private resolvePermission(id: string, allow: boolean): void {
    const resolve = this.permissions.get(id);
    if (!resolve) return;
    this.permissions.delete(id);
    this.post({ type: 'permissionResolved', id, allow });
    resolve(allow);
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
      void vscode.window.showWarningMessage('ContextBridge: open a folder to ask questions about it.');
      return;
    }
    const controller = new AbortController();
    this.pending = controller;
    const conversation = this.conversation;
    const provider = this.provider;
    const sent = this.attachments.summaries().map((item) => (item.range ? `${item.path}:${item.range.start}-${item.range.end}` : item.path));
    this.post({ type: 'start', question, attachments: sent, provider: provider.label, mode: this.mode, at: Date.now() });
    try {
      const resolved = applyLimits(await Promise.all(this.attachments.items.map(resolveAttachment)));
      for (const attachment of resolved) {
        if (attachment.omitted !== undefined) {
          this.post({ type: 'notice', text: `${attachment.path}: content not sent (${attachment.omitted}); sent as a reference only.` });
        }
      }
      const mode = this.mode;
      await provider.ask(
        {
          prompt: buildPrompt(resolved, question, mode),
          cwd,
          mode,
          requestPermission: (request) => this.requestPermission(request, controller.signal),
        },
        (event) => {
          // Recorded as events arrive: after New chat the provider is reset before this request ends.
          conversation.providerConversationId = provider.conversationId ?? conversation.providerConversationId;
          this.post(event.type === 'done' || event.type === 'error' ? { ...event, at: Date.now() } : event);
        },
        controller.signal,
      );
    } catch (error) {
      this.post({ type: 'error', message: error instanceof Error ? error.message : String(error), at: Date.now() });
    } finally {
      if (this.pending === controller) this.pending = undefined;
      if (conversation === this.conversation) {
        conversation.providerConversationId = provider.conversationId ?? conversation.providerConversationId;
        await this.saveNow();
      } else {
        await this.history.save(conversation.toJSON()).catch(() => {});
      }
    }
  }

  // Transcript messages are recorded in the current conversation, then shown if the view is open.
  private post(message: HostMessage): void {
    if (isTranscriptMessage(message)) {
      this.conversation.append(message);
      if (message.type === 'done' || message.type === 'error' || message.type === 'start') void this.saveNow();
      else this.scheduleSave();
    }
    void this.view?.webview.postMessage(message);
  }

  // Saves the current chat when VS Code shuts down or the extension is deactivated.
  dispose(): Promise<void> {
    this.pending?.abort();
    return this.saveNow();
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
      <select id="mode" aria-label="Mode">
        <option value="ask">Ask</option>
        <option value="agent">Agent</option>
      </select>
      <button type="button" id="history" class="secondary" title="Chat history">History</button>
      <button type="button" id="new-chat" class="secondary" title="Start a new chat">New</button>
    </div>
    <div id="status" class="muted"></div>
    <div id="agent-banner" hidden>Agent mode: the provider can edit files and run commands.</div>
  </header>
  <div id="messages" aria-live="polite"></div>
  <form id="composer">
    <div id="attachments"></div>
    <div class="input-wrap">
      <textarea id="question" rows="3" placeholder="Ask about your code (Enter to send, Shift+Enter for a new line)"></textarea>
    </div>
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

function relativeTime(timestamp: number): string {
  const minutes = Math.round((Date.now() - timestamp) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} d ago` : new Date(timestamp).toLocaleDateString();
}
