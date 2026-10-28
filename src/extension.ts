import * as vscode from 'vscode';
import { ChatViewProvider, type ModelChoice } from './chat/chatViewProvider.ts';
import { HistoryStore } from './chat/historyStore.ts';
import { linkAddress } from './chat/links.ts';
import { AttachmentStore } from './context/attachmentStore.ts';
import { collectFile, collectSelections, type CollectResult } from './context/collect.ts';
import { CurrentFileTracker } from './context/currentFile.ts';
import { ChangesView } from './git/changesView.ts';
import { pickFiles } from './context/picker.ts';
import { ClaudeProvider } from './providers/claudeProvider.ts';
import { CodexProvider, type CodexTransport, type CodexWebSearch } from './providers/codexProvider.ts';
import { CopilotProvider } from './providers/copilotProvider.ts';
import type { Mode, PermissionLevel } from './providers/types.ts';

let activeChatView: ChatViewProvider | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const attachments = new AttachmentStore();
  const config = () => vscode.workspace.getConfiguration('contextBridge');
  const stringSetting = (key: string) => config().get<string>(key)?.trim() || undefined;
  const providers = [
    new ClaudeProvider(() => stringSetting('claude.path'), vscode.Uri.joinPath(context.extensionUri, 'dist', 'git-mcp.cjs').fsPath),
    new CodexProvider(
      () => stringSetting('codex.path'),
      () => config().get<CodexTransport>('codex.transport', 'app-server'),
      () => config().get<CodexWebSearch>('codex.webSearch', 'live'),
    ),
    new CopilotProvider(() => stringSetting('copilot.path')),
  ];
  // Per-workspace storage, like VS Code's own chat history.
  const storage = context.storageUri ?? context.globalStorageUri;
  const changes = new ChangesView();
  context.subscriptions.push(changes);
  const currentFile = new CurrentFileTracker();
  context.subscriptions.push(currentFile);
  // The pickers' choices are remembered per workspace, like the chat history, and never written to
  // settings: other windows aren't affected. The settings are defaults where nothing was picked.
  const picks = context.workspaceState;
  const chatView = new ChatViewProvider({
    extensionUri: context.extensionUri,
    providers,
    providerId: picks.get<string>('provider') ?? config().get<string>('provider', 'claude'),
    mode: picks.get<Mode>('mode') ?? config().get<Mode>('mode', 'ask'),
    attachments,
    changes,
    currentFile,
    attachCurrentFile: () => config().get<boolean>('attachCurrentFile', true),
    history: new HistoryStore(vscode.Uri.joinPath(storage, 'chats').fsPath),
    maxChats: () => config().get<number>('history.maxChats', 50),
    defaultPermissionLevel: () => config().get<PermissionLevel>('agent.defaultPermissions', 'default'),
    memento: context.globalState,
    onProviderSelected: (id) => void picks.update('provider', id),
    onModeSelected: (mode) => void picks.update('mode', mode),
    // A pick of the CLI's default model/effort is stored with those fields absent; empty settings
    // also mean the CLI's own default.
    defaultModel: (id) => picks.get<ModelChoice>(`model.${id}`) ?? { model: stringSetting(`${id}.model`), effort: stringSetting(`${id}.effort`) },
    onModelSelected: (id, choice) => void picks.update(`model.${id}`, choice),
  });
  activeChatView = chatView;

  const statusItem = vscode.window.createStatusBarItem('contextBridge.toggle', vscode.StatusBarAlignment.Right, 100);
  statusItem.name = 'ContextBridge Chat';
  statusItem.text = '$(comment-discussion) ContextBridge';
  statusItem.tooltip = 'Toggle ContextBridge Chat';
  statusItem.command = 'contextBridge.toggle';
  statusItem.show();
  context.subscriptions.push(statusItem);

  const addAll = (results: CollectResult[]) => {
    for (const result of results) {
      if (result.ok) attachments.add(result.attachment);
      else void vscode.window.showWarningMessage(`ContextBridge: ${result.reason}`);
    }
    chatView.reveal();
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewId, chatView),
    vscode.commands.registerCommand('contextBridge.open', () => chatView.reveal()),
    vscode.commands.registerCommand('contextBridge.toggle', () => chatView.toggle()),
    // From the Explorer: (clicked, allSelected). From an editor tab: (uri). From the palette: nothing.
    vscode.commands.registerCommand('contextBridge.addFiles', async (clicked?: vscode.Uri, selected?: vscode.Uri[]) => {
      const uris = selected?.length ? selected : clicked ? [clicked] : [];
      const active = vscode.window.activeTextEditor?.document.uri;
      if (uris.length === 0 && active) uris.push(active);
      if (uris.length === 0) {
        void vscode.window.showInformationMessage('ContextBridge: open or select a file to attach.');
        return;
      }
      addAll(await Promise.all(uris.map(collectFile)));
    }),
    vscode.commands.registerCommand('contextBridge.addSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showInformationMessage('ContextBridge: open a file to attach a selection.');
        return;
      }
      addAll(await collectSelections(editor));
    }),
    vscode.commands.registerCommand('contextBridge.clearAttachments', () => attachments.clear()),
    vscode.commands.registerCommand('contextBridge.pickFiles', async () => {
      const picked = await pickFiles();
      if (!picked) return;
      const results = await Promise.all(picked.uris.map(collectFile));
      const editor = vscode.window.activeTextEditor;
      if (picked.selection && editor) results.push(...(await collectSelections(editor)));
      addAll(results);
    }),
    vscode.commands.registerCommand('contextBridge.newChat', () => chatView.newChat()),
    vscode.commands.registerCommand('contextBridge.showHistory', () => chatView.showHistory()),
    vscode.commands.registerCommand('contextBridge.clearHistory', () => chatView.clearHistory()),
    // From the chat's right-click menu, with the link's data-vscode-context.
    vscode.commands.registerCommand('contextBridge.copyLinkAddress', async (context?: { href?: string }) => {
      if (!context?.href) return;
      await vscode.env.clipboard.writeText(linkAddress(context.href, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath));
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      // Only settings edits get here (the pickers don't write settings). A new default applies
      // where this workspace hasn't picked its own, and isn't saved as a pick.
      if (event.affectsConfiguration('contextBridge.provider') && picks.get('provider') === undefined) {
        chatView.selectProvider(config().get<string>('provider', 'claude'), { remember: false });
      }
      if (event.affectsConfiguration('contextBridge.mode') && picks.get('mode') === undefined) {
        chatView.selectMode(config().get<Mode>('mode', 'ask'), { remember: false });
      }
      if (event.affectsConfiguration('contextBridge.attachCurrentFile')) chatView.setCurrentFileEnabled(config().get<boolean>('attachCurrentFile', true));
      if (event.affectsConfiguration('contextBridge.claude.path') || event.affectsConfiguration('contextBridge.codex.path') || event.affectsConfiguration('contextBridge.copilot.path')) {
        void chatView.refreshStatus();
      }
    }),
  );
}

// VS Code waits for this promise, so the current chat is saved on shutdown.
export function deactivate(): Promise<void> | undefined {
  return activeChatView?.dispose();
}
