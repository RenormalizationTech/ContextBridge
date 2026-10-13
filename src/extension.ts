import * as vscode from 'vscode';
import { ChatViewProvider } from './chat/chatViewProvider.ts';
import { HistoryStore } from './chat/historyStore.ts';
import { AttachmentStore } from './context/attachmentStore.ts';
import { collectFile, collectSelections, type CollectResult } from './context/collect.ts';
import { CurrentFileTracker } from './context/currentFile.ts';
import { pickFiles } from './context/picker.ts';
import { ClaudeProvider } from './providers/claudeProvider.ts';
import { CodexProvider, type CodexTransport, type CodexWebSearch } from './providers/codexProvider.ts';
import { MockProvider } from './providers/mockProvider.ts';
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
    new MockProvider(),
  ];
  // Per-workspace storage, like VS Code's own chat history.
  const storage = context.storageUri ?? context.globalStorageUri;
  const currentFile = new CurrentFileTracker();
  context.subscriptions.push(currentFile);
  const chatView = new ChatViewProvider({
    extensionUri: context.extensionUri,
    providers,
    providerId: config().get<string>('provider', 'claude'),
    mode: config().get<Mode>('mode', 'ask'),
    attachments,
    currentFile,
    attachCurrentFile: () => config().get<boolean>('attachCurrentFile', true),
    history: new HistoryStore(vscode.Uri.joinPath(storage, 'chats').fsPath),
    maxChats: () => config().get<number>('history.maxChats', 50),
    defaultPermissionLevel: () => config().get<PermissionLevel>('agent.defaultPermissions', 'default'),
    memento: context.globalState,
    onProviderSelected: (id) => void config().update('provider', id, vscode.ConfigurationTarget.Global),
    onModeSelected: (mode) => void config().update('mode', mode, vscode.ConfigurationTarget.Global),
    // Empty settings mean the CLI's own default. Mock has no model choice.
    defaultModel: (id) => (id === 'mock' ? {} : { model: stringSetting(`${id}.model`), effort: stringSetting(`${id}.effort`) }),
    onModelSelected: (id, { model, effort }) => {
      if (id === 'mock') return;
      void config().update(`${id}.model`, model ?? '', vscode.ConfigurationTarget.Global);
      void config().update(`${id}.effort`, effort ?? '', vscode.ConfigurationTarget.Global);
    },
  });
  activeChatView = chatView;

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
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('contextBridge.provider')) chatView.selectProvider(config().get<string>('provider', 'claude'));
      if (event.affectsConfiguration('contextBridge.mode')) chatView.selectMode(config().get<Mode>('mode', 'ask'));
      if (event.affectsConfiguration('contextBridge.attachCurrentFile')) chatView.setCurrentFileEnabled(config().get<boolean>('attachCurrentFile', true));
      if (event.affectsConfiguration('contextBridge.claude.path') || event.affectsConfiguration('contextBridge.codex.path')) {
        void chatView.refreshStatus();
      }
    }),
  );
}

// VS Code waits for this promise, so the current chat is saved on shutdown.
export function deactivate(): Promise<void> | undefined {
  return activeChatView?.dispose();
}
