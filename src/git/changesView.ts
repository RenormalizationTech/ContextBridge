import * as vscode from 'vscode';
import { join } from 'node:path';
import { readGit, readWorkspaceChanges, type WorkspaceChanges } from './workspaceChanges.ts';

// Repository-wide saved changes, independent of provider and chat history.
export class ChangesView implements vscode.Disposable {
  private readonly listeners = new Set<() => void>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly snapshots = new Map<string, { root: string; head: string; path: string }>();
  private readonly timer: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private visible = false;
  private disposed = false;
  private sequence = 0;
  current?: WorkspaceChanges;

  constructor() {
    this.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('contextbridge-before', {
      provideTextDocumentContent: async (uri) => {
        const snapshot = this.snapshots.get(uri.toString());
        if (!snapshot) throw new Error('This change snapshot is no longer available.');
        return readGit(snapshot.root, ['show', `${snapshot.head}:${snapshot.path}`]);
      },
    }));
    this.subscriptions.push(vscode.workspace.onDidSaveTextDocument(() => { if (this.visible) void this.refresh(); }));
    this.timer = setInterval(() => { if (this.visible) void this.refresh(); }, 3000);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible) void this.refresh();
  }

  onDidChange(listener: () => void): vscode.Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.running) return this.running;
    this.running = (async () => {
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri;
      let changes: WorkspaceChanges | undefined;
      if (cwd?.scheme === 'file') {
        try { changes = await readWorkspaceChanges(cwd.fsPath); } catch { /* No Git / no repository. */ }
      }
      if (this.disposed) return;
      if (JSON.stringify(changes) !== JSON.stringify(this.current)) {
        this.current = changes;
        for (const listener of this.listeners) listener();
      }
    })().finally(() => { this.running = undefined; });
    return this.running;
  }

  async open(): Promise<void> {
    await this.refresh();
    const changes = this.current;
    if (!changes?.files.length) {
      void vscode.window.showInformationMessage('ContextBridge: no uncommitted changes.');
      return;
    }
    const resources = changes.files.map((file) => {
      const uri = vscode.Uri.file(join(changes.root, file.path));
      let originalUri: vscode.Uri | undefined;
      if (!file.added && changes.head) {
        originalUri = vscode.Uri.from({ scheme: 'contextbridge-before', path: uri.path, query: String(++this.sequence) });
        this.snapshots.set(originalUri.toString(), { root: changes.root, head: changes.head, path: file.originalPath ?? file.path });
      }
      return { originalUri, modifiedUri: file.deleted ? undefined : uri };
    });
    try {
      // Same command and resource shape used by VS Code's built-in Git extension.
      await vscode.commands.executeCommand('_workbench.openMultiDiffEditor', {
        title: 'ContextBridge: Uncommitted Changes', resources,
      });
    } catch {
      // Older editor builds can still review individual files in the standard diff editor.
      const picked = await vscode.window.showQuickPick(changes.files.map((file, index) => ({
        label: file.path, description: file.binary ? 'Binary' : `+${file.additions} −${file.deletions}`, index,
      })), { title: 'Uncommitted Changes', placeHolder: 'Choose a file to review' });
      if (picked) {
        const resource = resources[picked.index];
        if (resource.originalUri && resource.modifiedUri) {
          await vscode.commands.executeCommand('vscode.diff', resource.originalUri, resource.modifiedUri, picked.label);
        } else {
          await vscode.commands.executeCommand('vscode.open', resource.originalUri ?? resource.modifiedUri);
        }
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    clearInterval(this.timer);
    for (const subscription of this.subscriptions) subscription.dispose();
    this.listeners.clear();
    this.snapshots.clear();
  }
}
