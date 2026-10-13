import * as vscode from 'vscode';
import { displayPath } from './collect.ts';

const MAX_FILES = 5000;
// Usually huge or generated; files.exclude applies on top of this.
const SKIP = /(^|\/)(node_modules|\.git|dist|out|build|\.venv|venv|__pycache__)\//;

type FileItem = vscode.QuickPickItem & { uri?: vscode.Uri; selection?: true };

// Copilot-style "+": a searchable list of open editors, then workspace files. Resolves with the
// chosen file URIs and whether the active editor's selection was picked.
export async function pickFiles(): Promise<{ uris: vscode.Uri[]; selection: boolean } | undefined> {
  const pick = vscode.window.createQuickPick<FileItem>();
  pick.title = 'Add to ContextBridge';
  pick.placeholder = 'Search files to attach (select several with Space or click)';
  pick.canSelectMany = true;
  pick.matchOnDescription = true;
  pick.busy = true;

  const editor = vscode.window.activeTextEditor;
  const head: FileItem[] = [];
  if (editor && !editor.selection.isEmpty) {
    const { start, end } = editor.selection;
    head.push({ label: '$(selection) Active selection', description: `${displayPath(editor.document.uri)}:${start.line + 1}-${end.line + 1}`, selection: true });
  }
  const open = openEditorUris();
  if (open.length > 0) {
    head.push({ label: 'Open editors', kind: vscode.QuickPickItemKind.Separator });
    head.push(...open.map(fileItem));
  }
  pick.items = head;
  pick.show();

  void vscode.workspace.findFiles('**/*', undefined, MAX_FILES).then((uris) => {
    const seen = new Set(open.map((uri) => uri.toString()));
    const files = uris
      .filter((uri) => !seen.has(uri.toString()) && !SKIP.test(vscode.workspace.asRelativePath(uri, false)))
      .sort((a, b) => a.path.localeCompare(b.path))
      .map(fileItem);
    if (files.length > 0) pick.items = [...head, { label: 'Workspace files', kind: vscode.QuickPickItemKind.Separator }, ...files];
    pick.busy = false;
  });

  return new Promise((resolve) => {
    pick.onDidAccept(() => {
      // With canSelectMany, Enter on a highlighted item that isn't ticked should still pick it.
      const chosen = pick.selectedItems.length > 0 ? pick.selectedItems : pick.activeItems;
      resolve({ uris: chosen.flatMap((item) => (item.uri ? [item.uri] : [])), selection: chosen.some((item) => item.selection) });
      pick.hide();
    });
    pick.onDidHide(() => {
      resolve(undefined);
      pick.dispose();
    });
  });
}

function fileItem(uri: vscode.Uri): FileItem {
  const path = displayPath(uri);
  const slash = path.lastIndexOf('/');
  return {
    label: slash >= 0 ? path.slice(slash + 1) : path,
    description: slash >= 0 ? path.slice(0, slash) : '',
    iconPath: vscode.ThemeIcon.File,
    uri,
  };
}

function openEditorUris(): vscode.Uri[] {
  const uris = new Map<string, vscode.Uri>();
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (input instanceof vscode.TabInputText && input.uri.scheme !== 'output') uris.set(input.uri.toString(), input.uri);
    }
  }
  return [...uris.values()];
}
