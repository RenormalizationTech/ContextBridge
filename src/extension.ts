import * as vscode from 'vscode';
import { ChatViewProvider } from './chat/chatViewProvider.ts';
import { AttachmentStore } from './context/attachmentStore.ts';
import { collectFile, collectSelections, type CollectResult } from './context/collect.ts';
import { ClaudeProvider } from './providers/claudeProvider.ts';
import { CodexProvider } from './providers/codexProvider.ts';
import { MockProvider } from './providers/mockProvider.ts';

export function activate(context: vscode.ExtensionContext): void {
  const attachments = new AttachmentStore();
  const config = () => vscode.workspace.getConfiguration('contextBridge');
  const pathSetting = (key: string) => config().get<string>(key)?.trim() || undefined;
  const providers = [
    new ClaudeProvider(() => pathSetting('claude.path')),
    new CodexProvider(() => pathSetting('codex.path')),
    new MockProvider(),
  ];
  const chatView = new ChatViewProvider(
    context.extensionUri,
    providers,
    config().get<string>('provider', 'claude'),
    attachments,
    (id) => void config().update('provider', id, vscode.ConfigurationTarget.Global),
  );

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
    vscode.commands.registerCommand('contextBridge.newChat', () => chatView.newChat()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('contextBridge.provider')) chatView.selectProvider(config().get<string>('provider', 'claude'));
      if (event.affectsConfiguration('contextBridge.claude.path') || event.affectsConfiguration('contextBridge.codex.path')) {
        void chatView.refreshStatus();
      }
    }),
  );
}

export function deactivate(): void {}
