import * as vscode from 'vscode';
import { isBinary } from './payload.ts';
import type { Attachment, LineRange, NewAttachment, ResolvedAttachment } from './types.ts';

export type CollectResult = { ok: true; attachment: NewAttachment } | { ok: false; reason: string };

export async function collectFile(uri: vscode.Uri): Promise<CollectResult> {
  const name = displayPath(uri);
  const document = openDocument(uri.toString());
  if (document) {
    return { ok: true, attachment: { kind: 'file', uri: uri.toString(), path: name, sizeBytes: byteLength(document.getText()) } };
  }
  let stat: vscode.FileStat;
  try {
    stat = await vscode.workspace.fs.stat(uri);
  } catch {
    return { ok: false, reason: `${name} was not found.` };
  }
  if (stat.type & vscode.FileType.Directory) {
    return { ok: false, reason: `${name} is a folder. Attach individual files instead.` };
  }
  if (isBinary(await vscode.workspace.fs.readFile(uri))) {
    return { ok: false, reason: `${name} looks like a binary file.` };
  }
  return { ok: true, attachment: { kind: 'file', uri: uri.toString(), path: name, sizeBytes: stat.size } };
}

// One attachment per non-empty selection; with no selection, the whole file.
export async function collectSelections(editor: vscode.TextEditor): Promise<CollectResult[]> {
  const ranges = selectedLines(editor);
  if (ranges.length === 0) return [await collectFile(editor.document.uri)];
  return ranges.map((range) => ({
    ok: true,
    attachment: { kind: 'selection', uri: editor.document.uri.toString(), path: displayPath(editor.document.uri), range, text: linesText(editor.document, range) },
  }));
}

// The editor's non-empty selections as whole lines (1-based), top to bottom. A selection ending
// at the start of a line does not include that line.
export function selectedLines(editor: vscode.TextEditor): LineRange[] {
  return editor.selections
    .filter((selection) => !selection.isEmpty)
    .map((selection) => {
      const endLine = selection.end.character === 0 && selection.end.line > selection.start.line ? selection.end.line - 1 : selection.end.line;
      return { start: selection.start.line + 1, end: endLine + 1 };
    })
    .sort((a, b) => a.start - b.start);
}

export function linesText(document: vscode.TextDocument, range: LineRange): string {
  return document.getText(new vscode.Range(range.start - 1, 0, range.end - 1, document.lineAt(range.end - 1).text.length));
}

// Reads current content at send time. Files that disappeared or became binary are omitted, not dropped.
export async function resolveAttachment(attachment: Attachment): Promise<ResolvedAttachment> {
  if (attachment.kind === 'selection') {
    return { path: attachment.path, range: attachment.range, text: attachment.text };
  }
  const document = openDocument(attachment.uri);
  if (document) return { path: attachment.path, text: document.getText() };
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.parse(attachment.uri));
    if (isBinary(bytes)) return { path: attachment.path, omitted: 'binary file' };
    return { path: attachment.path, text: new TextDecoder().decode(bytes) };
  } catch {
    return { path: attachment.path, omitted: 'file not found' };
  }
}

export function displayPath(uri: vscode.Uri): string {
  if (uri.scheme === 'untitled') return uri.path;
  return vscode.workspace.asRelativePath(uri, false);
}

function openDocument(uri: string): vscode.TextDocument | undefined {
  return vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri);
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
