import * as vscode from 'vscode';
import { ChatViewProvider } from './chat/chatViewProvider.ts';
import { AttachmentStore } from './context/attachmentStore.ts';
import { collectFile, collectSelections, type CollectResult } from './context/collect.ts';
import { MockProvider } from './providers/mockProvider.ts';

export function activate(context: vscode.ExtensionContext): void {
  const attachments = new AttachmentStore();
  const chatView = new ChatViewProvider(context.extensionUri, new MockProvider(), attachments);

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
  );
}

export function deactivate(): void {}
