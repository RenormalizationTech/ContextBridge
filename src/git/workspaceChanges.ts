import { execFile } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface ChangedFile {
  path: string;
  originalPath?: string;
  additions: number;
  deletions: number;
  binary: boolean;
  added: boolean;
  deleted: boolean;
}
export interface WorkspaceChanges {
  root: string;
  files: ChangedFile[];
  additions: number;
  deletions: number;
  head?: string;
}

// No index refresh, hooks, textconv or external diff programs.
export function readGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'color.ui=false', ...args], {
      cwd, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
      timeout: 10000, maxBuffer: 16 * 1024 * 1024,
    }, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}

// NUL-separated names preserve tabs/newlines; rename records have an extra pair of paths.
export function parseNumstat(text: string): Pick<ChangedFile, 'path' | 'originalPath' | 'additions' | 'deletions' | 'binary'>[] {
  const tokens = text.split('\0');
  const rows: ReturnType<typeof parseNumstat> = [];
  for (let i = 0; i < tokens.length; i++) {
    const row = tokens[i];
    if (!row) continue;
    const first = row.indexOf('\t');
    const second = row.indexOf('\t', first + 1);
    const added = row.slice(0, first), deleted = row.slice(first + 1, second);
    let path = row.slice(second + 1);
    let originalPath: string | undefined;
    if (!path) {
      originalPath = tokens[++i];
      path = tokens[++i];
    }
    rows.push({ path, originalPath, additions: Number(added) || 0, deletions: Number(deleted) || 0, binary: added === '-' || deleted === '-' });
  }
  return rows;
}

async function newFile(root: string, path: string): Promise<ChangedFile> {
  const stat = await lstat(join(root, path));
  // Do not follow symlinks out of the workspace or load large/binary files for counting.
  const data = stat.isFile() && stat.size <= 4 * 1024 * 1024 ? await readFile(join(root, path)) : undefined;
  const binary = !data || data.includes(0);
  const text = binary ? '' : data!.toString('utf8');
  const additions = text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0;
  return { path, additions, deletions: 0, binary, added: true, deleted: false };
}

export async function readWorkspaceChanges(cwd: string): Promise<WorkspaceChanges> {
  const root = (await readGit(cwd, ['rev-parse', '--show-toplevel'])).trimEnd();
  let head: string | undefined;
  try { head = (await readGit(root, ['rev-parse', '--verify', 'HEAD'])).trim(); } catch { /* Initial repository. */ }
  const files: ChangedFile[] = [];
  if (head) {
    const rows = parseNumstat(await readGit(root, ['diff', '--no-ext-diff', '--no-textconv', '--find-renames', '--numstat', '-z', head, '--']));
    const originals = new Set((await readGit(root, ['ls-tree', '-r', '--name-only', '-z', head])).split('\0'));
    for (const row of rows) {
      let deleted = false;
      try { await lstat(join(root, row.path)); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        deleted = true;
      }
      files.push({ ...row, added: !originals.has(row.originalPath ?? row.path), deleted });
    }
  }
  const newPaths = (await readGit(root, ['ls-files', ...(head ? [] : ['--cached']), '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
  const seen = new Set(files.map((file) => file.path));
  for (const path of newPaths) {
    if (seen.has(path)) continue;
    seen.add(path);
    try { files.push(await newFile(root, path)); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { root, files, head, additions: files.reduce((n, f) => n + f.additions, 0), deletions: files.reduce((n, f) => n + f.deletions, 0) };
}
