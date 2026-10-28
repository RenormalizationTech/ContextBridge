import { isAbsolute, resolve } from 'node:path';

export interface LinkTarget {
  path: string;
  // Zero-based, when the link names a line.
  line?: number;
}

// Resolves a file link from an answer. Paths may be relative to the workspace or absolute
// (Claude Code and Codex often write absolute ones), with an optional line as `#L12`,
// `#L12-L20`, `:12` or `:12:5`. Links with a scheme (http:, command:, …) are not files.
export function resolveFileLink(href: string, workspaceRoot: string): LinkTarget | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^[a-z]:[\\/]/i.test(href)) return undefined;
  const match = href.match(/^(.+?)(?:#L(\d+)(?:C\d+)?(?:-L?\d+(?:C\d+)?)?|:(\d+)(?::\d+)?(?:-\d+)?)?$/);
  if (!match) return undefined;
  let path: string;
  try {
    path = decodeURIComponent(match[1]);
  } catch {
    path = match[1];
  }
  const line = match[2] ?? match[3];
  return {
    path: isAbsolute(path) ? path : resolve(workspaceRoot, path),
    line: line ? Math.max(Number(line) - 1, 0) : undefined,
  };
}

// What "Copy Link Address" copies: file links as an absolute path (with `:line` when the link
// names one), anything else (web links, other schemes, or no workspace) as written.
export function linkAddress(href: string, workspaceRoot: string | undefined): string {
  const target = workspaceRoot ? resolveFileLink(href, workspaceRoot) : undefined;
  if (!target) return href;
  return target.line === undefined ? target.path : `${target.path}:${target.line + 1}`;
}
