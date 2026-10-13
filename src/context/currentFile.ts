import * as vscode from 'vscode';
import { displayPath, linesText, selectedLines } from './collect.ts';
import type { Attachment, LineRange } from './types.ts';

// The file in the active editor, attached automatically like Copilot's current-file context.
export interface CurrentFile {
  uri: string;
  path: string;
  // Non-empty selections (1-based lines); when there are any, they're sent instead of the file.
  selections: LineRange[];
  sizeBytes: number;
}

// Only real files and unsaved new files: not settings, output panels, Git diff sides or notebooks.
const SCHEMES = new Set(['file', 'untitled']);

// Follows the active text editor and its selection. Changes are reported at most every 150 ms,
// since selection events fire on every cursor move.
export class CurrentFileTracker implements vscode.Disposable {
  readonly #listeners = new Set<() => void>();
  readonly #subscriptions: vscode.Disposable[];
  #timer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.#subscriptions = [
      vscode.window.onDidChangeActiveTextEditor(() => this.#changed()),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor === vscode.window.activeTextEditor) this.#changed();
      }),
    ];
  }

  get current(): CurrentFile | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !SCHEMES.has(editor.document.uri.scheme)) return undefined;
    return {
      uri: editor.document.uri.toString(),
      path: displayPath(editor.document.uri),
      selections: selectedLines(editor),
      sizeBytes: new TextEncoder().encode(editor.document.getText()).length,
    };
  }

  // What to send, read at send time: the selections as snapshots, else the whole file.
  attachments(): Attachment[] {
    const editor = vscode.window.activeTextEditor;
    const current = this.current;
    if (!editor || !current) return [];
    if (current.selections.length === 0) {
      return [{ id: 'current', kind: 'file', uri: current.uri, path: current.path, sizeBytes: current.sizeBytes }];
    }
    return current.selections.map((range, index) => ({
      id: `current-${index}`,
      kind: 'selection',
      uri: current.uri,
      path: current.path,
      range,
      text: linesText(editor.document, range),
    }));
  }

  onDidChange(listener: () => void): vscode.Disposable {
    this.#listeners.add(listener);
    return { dispose: () => this.#listeners.delete(listener) };
  }

  dispose(): void {
    clearTimeout(this.#timer);
    for (const subscription of this.#subscriptions) subscription.dispose();
  }

  #changed(): void {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      for (const listener of this.#listeners) listener();
    }, 150);
  }
}
