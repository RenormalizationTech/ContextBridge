import * as vscode from 'vscode';
import { ChatViewProvider } from './chat/chatViewProvider.ts';
import { MockProvider } from './providers/mockProvider.ts';

export function activate(context: vscode.ExtensionContext): void {
  const chatView = new ChatViewProvider(context.extensionUri, new MockProvider());
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewId, chatView),
    vscode.commands.registerCommand('contextBridge.open', () =>
      vscode.commands.executeCommand(`${ChatViewProvider.viewId}.focus`),
    ),
  );
}

export function deactivate(): void {}
