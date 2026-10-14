import { homedir } from 'node:os';
import * as vscode from 'vscode';
import { formatBytes, type AttachmentStore } from '../context/attachmentStore.ts';
import { resolveAttachment } from '../context/collect.ts';
import type { CurrentFileTracker } from '../context/currentFile.ts';
import { applyLimits, buildPrompt, MAX_ATTACHMENT_BYTES } from '../context/payload.ts';
import type { Attachment } from '../context/types.ts';
import type { ChangesView } from '../git/changesView.ts';
import type { Mode, ModelCatalog, PermissionLevel, PermissionRequest, Provider, ProviderStatus } from '../providers/types.ts';
import { Conversation, isTranscriptMessage } from './conversation.ts';
import type { HistoryStore } from './historyStore.ts';
import { OTHER_MODEL, type CurrentFileState, type HostMessage, type TranscriptMessage, type WebviewMessage } from './messages.ts';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'contextBridge.chat';

  private view?: vscode.WebviewView;
  private pending?: AbortController;
  private providerId: string;
  private mode: Mode;
  private nextPermissionId = 1;
  private readonly permissions = new Map<string, { resolve: (allow: boolean) => void; alwaysKey?: string }>();
  // "Always allow" choices for the current chat only; never saved or written to settings.
  private alwaysAllowed = new Set<string>();
  private readonly statuses = new Map<string, ProviderStatus>();
  // Model lists read from each CLI, refreshed for each new chat (the user's CLI config may change).
  private readonly catalogs = new Map<string, ModelCatalog>();
  // Default efforts of models the list doesn't give one for, looked up as they're picked.
  private readonly defaultEfforts = new Map<string, string | undefined>();
  private readonly extensionUri: vscode.Uri;
  private readonly providers: readonly Provider[];
  private readonly attachments: AttachmentStore;
  private readonly onProviderSelected: (id: string) => void;
  private readonly onModeSelected: (mode: Mode) => void;
  private readonly history: HistoryStore;
  private readonly maxChats: () => number;
  private readonly defaultPermissionLevel: () => PermissionLevel;
  private readonly memento: vscode.Memento;
  private readonly defaultModel: (providerId: string) => ModelChoice;
  private readonly onModelSelected: (providerId: string, choice: ModelChoice) => void;
  private permissionLevel: PermissionLevel;
  private readonly changes: ChangesView;
  private readonly currentFile: CurrentFileTracker;
  private readonly attachCurrentFile: () => boolean;
  // Per chat: × on the current-file chip turns it off until it's clicked again or a new chat starts.
  private currentFileEnabled: boolean;
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
    // The active editor's file, attached automatically (contextBridge.attachCurrentFile).
    changes: ChangesView;
    currentFile: CurrentFileTracker;
    attachCurrentFile: () => boolean;
    history: HistoryStore;
    maxChats: () => number;
    defaultPermissionLevel: () => PermissionLevel;
    // For "don't ask again" on the Bypass Approvals warning.
    memento: vscode.Memento;
    onProviderSelected: (id: string) => void;
    onModeSelected: (mode: Mode) => void;
    // Model and effort for new chats with a provider, and where a picked one is remembered.
    defaultModel: (providerId: string) => ModelChoice;
    onModelSelected: (providerId: string, choice: ModelChoice) => void;
  }) {
    this.extensionUri = options.extensionUri;
    this.providers = options.providers;
    this.providerId = this.providers.some((provider) => provider.id === options.providerId) ? options.providerId : this.providers[0].id;
    this.mode = options.mode;
    this.attachments = options.attachments;
    this.history = options.history;
    this.maxChats = options.maxChats;
    this.defaultPermissionLevel = options.defaultPermissionLevel;
    this.memento = options.memento;
    this.permissionLevel = this.defaultPermissionLevel();
    this.onProviderSelected = options.onProviderSelected;
    this.onModeSelected = options.onModeSelected;
    this.defaultModel = options.defaultModel;
    this.onModelSelected = options.onModelSelected;
    this.conversation = new Conversation({ providerId: this.providerId, ...this.defaultModel(this.providerId) });
    this.attachments.onDidChange(() => this.postState());
    this.changes = options.changes;
    this.changes.onDidChange(() => this.postState());
    this.currentFile = options.currentFile;
    this.attachCurrentFile = options.attachCurrentFile;
    this.currentFileEnabled = this.attachCurrentFile();
    this.currentFile.onDidChange(() => this.postState());
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
    // refreshStatus loads the new provider's models.
    this.newChat({ reloadModels: false });
    void this.refreshStatus();
  }

  // Switching modes keeps the conversation; the next question runs with the new mode's permissions.
  selectMode(mode: Mode): void {
    if (mode === this.mode || (mode !== 'ask' && mode !== 'agent')) return;
    this.mode = mode;
    this.onModeSelected(mode);
    this.postState();
  }

  // Per chat, like Copilot: changing it affects only the current chat (and is saved with it).
  async selectPermissionLevel(level: PermissionLevel): Promise<void> {
    if (level === this.permissionLevel || (level !== 'default' && level !== 'bypass')) return;
    if (level === 'bypass' && !this.memento.get<boolean>('bypassWarningDismissed')) {
      const choice = await vscode.window.showWarningMessage(
        'Enable Bypass Approvals?',
        {
          modal: true,
          detail: 'In Agent mode, every edit, command and tool call the provider asks about will be approved automatically for this chat, without asking you. Each one is still listed in the chat, and you can press Cancel at any time.',
        },
        'Enable',
        "Enable and Don't Ask Again",
      );
      if (!choice) {
        this.postState();
        return;
      }
      if (choice !== 'Enable') await this.memento.update('bypassWarningDismissed', true);
    }
    this.permissionLevel = level;
    this.conversation.permissionLevel = level;
    this.postState();
    this.scheduleSave();
  }

  // Per chat, and remembered for new chats with this provider (like Copilot's model picker).
  // A change mid-chat applies from the next question; the CLI conversation continues.
  async selectModel(model: string): Promise<void> {
    if (model === OTHER_MODEL) {
      const typed = await vscode.window.showInputBox({
        title: `${this.provider.label} model`,
        prompt: 'A model name the CLI accepts, such as a full model id.',
        value: this.conversation.model,
        validateInput: (value) => (/^[\w.:@/-]+$/.test(value.trim()) ? undefined : 'Use letters, digits and . : @ / - _ only.'),
      });
      if (!typed?.trim()) {
        this.postState();
        return;
      }
      model = typed.trim();
    }
    this.setModel({ model: model || undefined, effort: this.conversation.effort });
  }

  selectEffort(effort: string): void {
    this.setModel({ model: this.conversation.model, effort: effort || undefined });
  }

  private setModel(choice: ModelChoice): void {
    // An effort the new model doesn't support falls back to the default.
    const efforts = this.effortsFor(choice.model);
    if (choice.effort && efforts && !efforts.includes(choice.effort)) {
      this.post({ type: 'notice', text: `${this.modelLabel(choice.model)} ${efforts.length ? `doesn't support "${choice.effort}" effort` : "doesn't have effort levels"}, so effort was reset to Default.` });
      choice = { ...choice, effort: undefined };
    }
    this.conversation.model = choice.model;
    this.conversation.effort = choice.effort;
    this.onModelSelected(this.providerId, choice);
    this.postState();
    this.scheduleSave();
  }

  // Effort levels to offer for a model (a guess for typed-in models the CLI doesn't list).
  private effortsFor(model: string | undefined): string[] | undefined {
    const catalog = this.catalogs.get(this.providerId);
    return catalog && (this.knownEfforts(model) ?? catalog.efforts);
  }

  // Effort levels the CLI says a model supports; undefined when it doesn't say.
  private knownEfforts(model: string | undefined): string[] | undefined {
    const catalog = this.catalogs.get(this.providerId);
    if (!catalog) return undefined;
    return model === undefined ? (catalog.defaultEffortsUnknown ? [] : catalog.defaultModel?.efforts) : catalog.models.find((option) => option.id === model)?.efforts;
  }

  private modelLabel(model: string | undefined): string {
    const catalog = this.catalogs.get(this.providerId);
    if (model === undefined) return catalog?.defaultModel?.label ?? 'The default model';
    return catalog?.models.find((option) => option.id === model)?.label ?? model;
  }

  // The effort a model uses when none is chosen, for the "Default effort (…)" label. Looked up
  // from the CLI when its list doesn't include it; the label updates once the answer arrives.
  private defaultEffortFor(model: string | undefined): string | undefined {
    const catalog = this.catalogs.get(this.providerId);
    if (!catalog) return undefined;
    if (model === undefined) return catalog.defaultModel?.effort;
    const listed = catalog.models.find((option) => option.id === model)?.defaultEffort;
    if (listed) return listed;
    const provider = this.provider;
    const key = `${provider.id}:${model}`;
    if (this.defaultEfforts.has(key) || !provider.defaultEffort) return this.defaultEfforts.get(key);
    this.defaultEfforts.set(key, undefined);
    void provider.defaultEffort(model, this.cwd()).then((effort) => {
      this.defaultEfforts.set(key, effort);
      if (effort) this.postState();
    }, () => {});
    return undefined;
  }

  private cwd(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir();
  }

  private async loadModels(): Promise<void> {
    const provider = this.provider;
    // Failures keep the previous list, and the next new chat tries again.
    const catalog = await provider.listModels(this.cwd()).catch(() => undefined);
    if (!catalog) return;
    this.catalogs.set(provider.id, catalog);
    for (const key of this.defaultEfforts.keys()) if (key.startsWith(`${provider.id}:`)) this.defaultEfforts.delete(key);
    this.postState();
  }

  // The footer's model line. The effort is what the CLI reports applying, else the one sent (marked
  // as requested if the CLI doesn't list the model's efforts), else the model's listed default.
  private footerModel(event: { model: string; effort?: string; effortConfirmed?: boolean }, chosen: string | undefined, sent: string | undefined): TranscriptMessage {
    if (event.effortConfirmed) return { type: 'model', model: event.model, effort: event.effort };
    if (sent) return { type: 'model', model: event.model, effort: sent, requested: this.knownEfforts(chosen) === undefined || undefined };
    const catalog = this.catalogs.get(this.providerId);
    const listed = catalog?.models.find((option) => option.id === event.model || option.resolvesTo === event.model)?.defaultEffort;
    return { type: 'model', model: event.model, effort: event.effort ?? listed ?? (chosen === undefined ? catalog?.defaultModel?.effort : undefined) };
  }

  // The CLI rejected the chat's model (retired, misspelled, or not on this account): use the
  // default from now on, and stop offering it to new chats.
  private dropUnavailableModel(conversation: Conversation, providerId: string): void {
    const model = conversation.model;
    if (!model) return;
    conversation.model = undefined;
    const defaults = this.defaultModel(providerId);
    if (defaults.model === model) this.onModelSelected(providerId, { model: undefined, effort: defaults.effort });
    if (conversation !== this.conversation) return;
    this.post({ type: 'notice', text: `The model "${model}" isn't available, so this chat switched to the default model. Ask again to continue.` });
    this.postState();
  }

  // For the current chat; new chats start from contextBridge.attachCurrentFile.
  setCurrentFileEnabled(enabled: boolean): void {
    this.currentFileEnabled = enabled;
    this.postState();
  }

  newChat(options: { reloadModels?: boolean } = {}): void {
    this.pending?.abort();
    void this.saveNow();
    this.conversation = new Conversation({ providerId: this.providerId, ...this.defaultModel(this.providerId) });
    this.permissionLevel = this.defaultPermissionLevel();
    this.alwaysAllowed = new Set();
    this.currentFileEnabled = this.attachCurrentFile();
    this.provider.resetConversation();
    this.post({ type: 'cleared' });
    this.postState();
    if (options.reloadModels !== false && this.statuses.get(this.providerId)?.ok) void this.loadModels();
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
    if (!this.providers.some(provider => provider.id === stored.providerId)) {
      void vscode.window.showWarningMessage('ContextBridge: this chat used a provider that is no longer available. Start a new chat.');
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
    this.permissionLevel = stored.permissionLevel ?? this.defaultPermissionLevel();
    this.alwaysAllowed = new Set();
    this.currentFileEnabled = this.attachCurrentFile();
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
    const status = await provider.checkStatus();
    this.statuses.set(provider.id, status);
    this.postState();
    if (status.ok && provider === this.provider) await this.loadModels();
  }

  // Once per session: if the saved provider's CLI isn't installed, switch to one that is, so a
  // user with only one CLI doesn't start on a "not found" error.
  private async selectInstalledProvider(): Promise<void> {
    if (this.checkedInstalledProvider) return;
    this.checkedInstalledProvider = true;
    const current = this.provider;
    if (this.statuses.get(current.id)?.installed !== false || this.pending || !this.conversation.isEmpty) return;
    for (const candidate of this.providers) {
      if (candidate.id === current.id) continue;
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
    this.changes.setVisible(view.visible);
    view.onDidChangeVisibility(() => this.changes.setVisible(view.visible));
    const mediaUri = vscode.Uri.joinPath(this.extensionUri, 'media');
    const distUri = vscode.Uri.joinPath(this.extensionUri, 'dist');
    view.webview.options = { enableScripts: true, localResourceRoots: [mediaUri, distUri] };
    view.webview.html = this.renderHtml(view.webview, mediaUri, distUri);
    view.webview.onDidReceiveMessage((message: WebviewMessage) => this.handleMessage(message));
    // A running answer keeps going while the view is hidden; it is replayed when the view returns.
    view.onDidDispose(() => {
      if (this.view === view) {
        this.view = undefined;
        this.changes.setVisible(false);
      }
    });
  }

  private handleMessage(message: WebviewMessage): void {
    switch (message.type) {
      case 'ready':
        if (this.statuses.has(this.providerId)) this.postState();
        else void this.refreshStatus().then(() => this.selectInstalledProvider());
        this.post({ type: 'restore', messages: this.conversation.messages });
        break;
      case 'showChanges':
        void this.changes.open();
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
      case 'selectPermissionLevel':
        void this.selectPermissionLevel(message.level);
        break;
      case 'selectModel':
        void this.selectModel(message.model);
        break;
      case 'selectEffort':
        this.selectEffort(message.effort);
        break;
      case 'permissionResponse':
        this.resolvePermission(message.id, message.allow, message.always === true);
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
      case 'setCurrentFile':
        this.setCurrentFileEnabled(message.enabled === true);
        break;
      case 'pickFiles':
        void vscode.commands.executeCommand('contextBridge.pickFiles');
        break;
    }
  }

  private postState(): void {
    this.post({
      type: 'state',
      providers: this.providers.map(({ id, label }) => ({ id, label })),
      providerId: this.providerId,
      mode: this.mode,
      permissionLevel: this.permissionLevel,
      models: this.catalogs.get(this.providerId),
      model: this.conversation.model,
      effort: this.conversation.effort,
      defaultEffort: this.defaultEffortFor(this.conversation.model),
      status: this.statuses.get(this.providerId),
      attachments: this.attachments.summaries(),
      currentFile: this.currentFileState(),
      changes: this.changes.current && {
        files: this.changes.current.files.length,
        additions: this.changes.current.additions,
        deletions: this.changes.current.deletions,
      },
    });
  }

  private currentFileState(): CurrentFileState | undefined {
    const current = this.currentFile.current;
    if (!current || this.implicitAttachments().length === 0) return undefined;
    const tooLarge = current.selections.length === 0 && current.sizeBytes > MAX_ATTACHMENT_BYTES;
    return {
      path: current.path,
      selections: current.selections,
      enabled: this.currentFileEnabled,
      note: tooLarge ? `Too large (${formatBytes(current.sizeBytes)}): sent as a reference only` : undefined,
    };
  }

  // The current file's attachments, minus what the user already attached by hand (the whole file,
  // or the same selection), so nothing is sent twice.
  private implicitAttachments(): Attachment[] {
    const explicit = this.attachments.items;
    return this.currentFile.attachments().filter((implicit) => !explicit.some((item) =>
      item.uri === implicit.uri && (item.kind === 'file' || (implicit.kind === 'selection' && item.range.start === implicit.range.start && item.range.end === implicit.range.end))));
  }

  private requestPermission(request: PermissionRequest, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false);
    const summary = `${request.tool}${request.detail ? ` ${request.detail}` : ''}`;
    if (this.permissionLevel === 'bypass' && !request.requireUser) {
      this.post({ type: 'notice', text: `Approved automatically (Bypass Approvals): ${summary}` });
      return Promise.resolve(true);
    }
    const alwaysKey = request.always ? `${this.providerId}:${request.always.key}` : undefined;
    if (alwaysKey && !request.requireUser && this.alwaysAllowed.has(alwaysKey)) {
      // Shown in the chat so auto-approved actions are never invisible.
      this.post({ type: 'notice', text: `Allowed automatically (always allow): ${summary}` });
      return Promise.resolve(true);
    }
    const id = String(this.nextPermissionId++);
    return new Promise((resolve) => {
      this.permissions.set(id, { resolve, alwaysKey });
      signal.addEventListener('abort', () => this.resolvePermission(id, false), { once: true });
      this.post({ type: 'permission', id, ...request });
      this.reveal();
    });
  }

  private resolvePermission(id: string, allow: boolean, always = false): void {
    const pending = this.permissions.get(id);
    if (!pending) return;
    this.permissions.delete(id);
    const remember = allow && always && pending.alwaysKey !== undefined;
    if (remember) this.alwaysAllowed.add(pending.alwaysKey!);
    this.post({ type: 'permissionResolved', id, allow, always: remember || undefined });
    pending.resolve(allow);
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
    // The current file is read now: its selection at send time, else the whole file.
    const implicit = this.currentFileEnabled ? this.implicitAttachments() : [];
    const items = [...this.attachments.items, ...implicit];
    const sent = items.map((item) => (item.kind === 'selection' ? `${item.path}:${item.range.start}-${item.range.end}` : item.path));
    this.post({ type: 'start', question, attachments: sent, provider: provider.label, mode: this.mode, at: Date.now() });
    try {
      const resolved = applyLimits(await Promise.all(items.map(async (item) => ({ ...(await resolveAttachment(item)), current: implicit.includes(item) || undefined }))));
      for (const attachment of resolved) {
        if (attachment.omitted !== undefined) {
          this.post({ type: 'notice', text: `${attachment.path}: content not sent (${attachment.omitted}); sent as a reference only.` });
        }
      }
      // The CLIs silently ignore an effort the model doesn't support, so it's left out, and the
      // chat goes back to Default effort. Typed-in models the CLI doesn't list are sent as is.
      let effort = conversation.effort;
      const known = this.knownEfforts(conversation.model);
      if (effort && known && !known.includes(effort)) {
        const label = this.modelLabel(conversation.model);
        const fallback = this.defaultEffortFor(conversation.model);
        this.post({
          type: 'notice',
          text: known.length
            ? `${label} doesn't support "${effort}" effort, so it uses its default effort${fallback ? ` (${fallback})` : ''}. This chat's effort is now Default.`
            : `${label} doesn't have effort levels, so the "${effort}" effort was left out. This chat's effort is now Default.`,
        });
        effort = undefined;
        conversation.effort = undefined;
        this.postState();
      }
      const mode = this.mode;
      await provider.ask(
        {
          prompt: buildPrompt(resolved, question, mode),
          cwd,
          mode,
          model: conversation.model,
          effort,
          requestPermission: (request) => this.requestPermission(request, controller.signal),
        },
        (event) => {
          // Recorded as events arrive: after New chat the provider is reset before this request ends.
          conversation.providerConversationId = provider.conversationId ?? conversation.providerConversationId;
          if (event.type === 'error') {
            const { modelUnavailable, ...error } = event;
            this.post({ ...error, at: Date.now() });
            if (modelUnavailable) this.dropUnavailableModel(conversation, provider.id);
          } else if (event.type === 'model') {
            this.post(this.footerModel(event, conversation.model, effort));
          } else {
            this.post(event.type === 'done' ? { ...event, at: Date.now() } : event);
          }
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
    const katexStyleUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'katex', 'katex.min.css'));
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <!-- KaTeX positions subscripts and accents with inline style attributes, so style-src allows
       'unsafe-inline'. Scripts stay nonce-only; answers can't add HTML (markdown-it html:false). -->
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${katexStyleUri}" rel="stylesheet">
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
  <button type="button" id="changes" class="secondary" hidden title="Review all uncommitted changes"></button>
  <div id="messages" aria-live="polite"></div>
  <form id="composer">
    <div class="attachment-row">
      <button type="button" id="add-files" class="icon-button" title="Add files or the current selection" aria-label="Add files">+</button>
      <div id="attachments"></div>
    </div>
    <div class="input-wrap">
      <textarea id="question" rows="3" placeholder="Ask about your code (Enter to send, Shift+Enter for a new line)"></textarea>
    </div>
    <div class="actions">
      <select id="model" aria-label="Model" title="Model for this chat" hidden></select>
      <select id="effort" aria-label="Effort" title="Reasoning effort for this chat" hidden></select>
      <select id="permissions" aria-label="Agent permissions" title="How Agent mode handles actions the provider asks about" hidden>
        <option value="default">Default Permissions</option>
        <option value="bypass">Bypass Approvals</option>
      </select>
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

export interface ModelChoice {
  model?: string;
  effort?: string;
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
