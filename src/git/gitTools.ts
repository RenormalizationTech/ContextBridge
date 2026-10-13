// Read-only Git commands for Claude Code's Ask mode, offered as ContextBridge's own MCP tools
// (served by gitServer.ts). Bash stays unavailable in Ask mode: with it, allow rules in the user's
// Claude settings would apply before ContextBridge sees a command. These tools build the git command
// themselves, so only status, diff, log and show can run, with checked arguments.

export interface GitToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const revision = {
  type: 'string',
  description: 'A commit, branch, tag or range, e.g. "HEAD~3", "main", "main...HEAD" or "a1b2c3d..HEAD".',
};
const paths = { type: 'array', items: { type: 'string' }, description: 'Limit to these files or folders (relative to the repository).' };

export const GIT_TOOLS: GitToolDefinition[] = [
  {
    name: 'git_status',
    description: 'Show the current branch and which files are modified, staged or untracked (git status --short --branch). Read-only.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'git_diff',
    description:
      "Show changes as a diff. With no arguments: the user's uncommitted changes in the working tree (not yet staged). " +
      'staged: changes staged for the next commit. base: compare against a commit, branch or range instead. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        staged: { type: 'boolean', description: 'Show staged changes (git diff --cached).' },
        base: revision,
        paths,
        stat: { type: 'boolean', description: 'Only list changed files with line counts (--stat).' },
      },
    },
  },
  {
    name: 'git_log',
    description: 'Show commit history, newest first: hash, author, date and message. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        revision,
        paths,
        maxCount: { type: 'integer', minimum: 1, maximum: 200, description: 'How many commits (default 20).' },
        patch: { type: 'boolean', description: 'Include each commit\'s diff (-p).' },
        stat: { type: 'boolean', description: 'Include changed files with line counts (--stat).' },
      },
    },
  },
  {
    name: 'git_show',
    description: 'Show one commit with its diff, or a file as it was at a commit ("HEAD~2:src/app.ts"). Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        revision: { type: 'string', description: 'A commit (e.g. "HEAD", "a1b2c3d") or "<commit>:<path>".' },
        stat: { type: 'boolean', description: 'Only list changed files with line counts (--stat).' },
      },
      required: ['revision'],
    },
  },
];

// Options that keep git from running external programs: no external diff tools or textconv filters.
const NO_EXTERNAL = ['--no-ext-diff', '--no-textconv'];

// The git arguments for a tool call. Throws with a message for the model when the input is invalid.
// Revisions and paths can never start with "-", so they can't smuggle in options such as --output.
export function gitArgs(tool: string, input: Record<string, unknown>): string[] {
  switch (tool) {
    case 'git_status':
      return ['status', '--short', '--branch'];
    case 'git_diff':
      return [
        'diff',
        ...NO_EXTERNAL,
        ...(flag(input, 'staged') ? ['--cached'] : []),
        ...(flag(input, 'stat') ? ['--stat'] : []),
        ...optionalRevision(input, 'base'),
        '--',
        ...pathList(input),
      ];
    case 'git_log': {
      const maxCount = input.maxCount ?? 20;
      if (!Number.isInteger(maxCount) || (maxCount as number) < 1 || (maxCount as number) > 200) throw new Error('maxCount must be a whole number from 1 to 200.');
      return [
        'log',
        `--max-count=${maxCount}`,
        '--date=iso',
        ...NO_EXTERNAL,
        ...(flag(input, 'patch') ? ['--patch'] : []),
        ...(flag(input, 'stat') ? ['--stat'] : []),
        ...optionalRevision(input, 'revision'),
        '--',
        ...pathList(input),
      ];
    }
    case 'git_show': {
      const value = optionalRevision(input, 'revision');
      if (value.length === 0) throw new Error('revision is required.');
      return ['show', ...NO_EXTERNAL, ...(flag(input, 'stat') ? ['--stat'] : []), ...value];
    }
    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}

// What the chat's activity line shows, e.g. "git diff --cached -- src/app.ts".
export function gitCommandLine(tool: string, input: Record<string, unknown>): string {
  try {
    const args = gitArgs(tool, input).filter((arg) => !NO_EXTERNAL.includes(arg) && arg !== '--date=iso');
    while (args.at(-1) === '--') args.pop();
    return `git ${args.join(' ')}`;
  } catch {
    return `git ${tool.replace(/^git_/, '')}`;
  }
}

function flag(input: Record<string, unknown>, key: string): boolean {
  const value = input[key];
  if (value !== undefined && typeof value !== 'boolean') throw new Error(`${key} must be true or false.`);
  return value === true;
}

// Commit names, ranges and "<commit>:<path>"; no spaces, and never an option.
const REVISION = /^[A-Za-z0-9_./@^~{}:+-]+$/;

function optionalRevision(input: Record<string, unknown>, key: string): string[] {
  const value = input[key];
  if (value === undefined || value === '') return [];
  if (typeof value !== 'string' || value.length > 200 || value.startsWith('-') || !REVISION.test(value)) {
    throw new Error(`${key} must be a commit, branch, tag or range such as "HEAD~1" or "main...HEAD", and can't start with "-".`);
  }
  return [value];
}

function pathList(input: Record<string, unknown>): string[] {
  const value = input.paths;
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50) throw new Error('paths must be a list of up to 50 paths.');
  return value.map((path) => {
    if (typeof path !== 'string' || path === '' || path.startsWith('-') || path.includes('\0')) {
      throw new Error('Each path must be a non-empty relative path that does not start with "-".');
    }
    return path;
  });
}
