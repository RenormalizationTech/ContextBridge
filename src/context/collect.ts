import * as vscode from 'vscode';
import { isBinary } from './payload.ts';
import type { Attachment, NewAttachment, ResolvedAttachment } from './types.ts';

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
  const selections = editor.selections.filter((selection) => !selection.isEmpty);
  if (selections.length === 0) return [await collectFile(editor.document.uri)];
  return selections.map((selection) => {
    // A selection ending at the start of a line does not include that line.
    const endLine = selection.end.character === 0 && selection.end.line > selection.start.line
      ? selection.end.line - 1
      : selection.end.line;
    const range = new vscode.Range(selection.start.line, 0, endLine, editor.document.lineAt(endLine).text.length);
    return {
      ok: true,
      attachment: {
        kind: 'selection',
        uri: editor.document.uri.toString(),
        path: displayPath(editor.document.uri),
        range: { start: selection.start.line + 1, end: endLine + 1 },
        text: editor.document.getText(range),
      },
    };
  });
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
