import { relative, isAbsolute } from 'node:path';
import type { ModelCatalog, ProviderEvent } from './types.ts';

// Built-in tools that exist in Ask mode. Edit, Write, Bash and other tools that can modify the
// workspace are not in the list, so they don't exist for the model (validated in Phase 1).
export const ASK_MODE_TOOLS = ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'Agent', 'ToolSearch'];

// Answers the CLI's permission prompts: read tools and all MCP tools are allowed (owner decision:
// MCP side effects are an accepted, documented risk); anything else is denied.
export function askModePermission(toolName: string): { behavior: 'allow' } | { behavior: 'deny'; message: string } {
  if (ASK_MODE_TOOLS.includes(toolName) || toolName.startsWith('mcp__')) return { behavior: 'allow' };
  return { behavior: 'deny', message: 'ContextBridge Ask mode does not allow this tool.' };
}

// What an Agent-mode approval card shows for a tool call.
export function describeToolCall(toolName: string, input: Record<string, any>): { detail: string; preview?: string } {
  const str = (value: unknown) => (typeof value === 'string' ? value : '');
  switch (toolName) {
    case 'Bash':
      return { detail: str(input.command), preview: str(input.description) || undefined };
    case 'Edit':
      return { detail: str(input.file_path), preview: clip(`- ${str(input.old_string)}\n+ ${str(input.new_string)}`) };
    case 'MultiEdit':
      return { detail: str(input.file_path), preview: `${(input.edits ?? []).length} edits` };
    case 'Write':
      return { detail: str(input.file_path), preview: clip(str(input.content)) };
    case 'NotebookEdit':
      return { detail: str(input.notebook_path) };
    default: {
      const first = ['file_path', 'path', 'url', 'command', 'query', 'pattern'].map((key) => str(input[key])).find(Boolean);
      return { detail: first ?? '', preview: first ? undefined : clip(JSON.stringify(input, null, 2)) };
    }
  }
}

function clip(text: string, limit = 1200): string {
  return text.length > limit ? `${text.slice(0, limit)}\n… (${text.length - limit} more characters)` : text;
}

// The pickers' model list from Claude Code's `initialize` control response (every model with its
// effort levels) and `get_settings` (the model and effort that apply when none is chosen, after
// the user's Claude settings). Undefined if the CLI didn't answer them.
export function claudeCatalog(init: any, settings: any): ModelCatalog | undefined {
  const listed: any[] = (init?.models ?? []).filter((model: any) => typeof model?.value === 'string');
  if (listed.length === 0) return undefined;
  const effortsOf = (model: any): string[] => (Array.isArray(model?.supportedEffortLevels) ? model.supportedEffortLevels : []);
  const models = listed
    .filter((model) => model.value !== 'default')
    .map((model) => ({ id: model.value as string, label: (model.displayName as string) || model.value, efforts: effortsOf(model), resolvesTo: model.resolvedModel as string | undefined }));
  const fallback = listed.find((model) => model.value === 'default');
  const applied = settings?.applied ?? {};
  const resolved: string | undefined = applied.model ?? fallback?.resolvedModel;
  const match = models.find((model) => model.resolvesTo === resolved);
  return {
    models,
    efforts: [...new Set(models.flatMap((model) => model.efforts))],
    defaultModel: resolved
      ? { label: match?.label ?? resolved, efforts: match?.efforts ?? effortsOf(fallback), effort: applied.effort ?? undefined }
      : undefined,
  };
}

// Fallback when `initialize` isn't available: the model aliases `claude --help` names (each
// resolves to that family's latest model) and its --effort levels. The fallbacks are what Claude
// Code 2.1.296 lists; a full model name can always be typed in.
const FALLBACK_ALIASES = ['fable', 'opus', 'sonnet', 'haiku'];
const FALLBACK_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

export function claudeModelCatalog(help: string | undefined): ModelCatalog {
  const text = (help ?? '').replace(/\s+/g, ' ');
  const modelHelp = text.match(/(?<![\w-])--model <model> (.*?) --?[a-z]/)?.[1] ?? '';
  const named = [...modelHelp.matchAll(/'([a-z][\w.-]*)'/g)].map((match) => match[1]);
  const aliases = [...new Set([...named, ...FALLBACK_ALIASES])];
  const effortList = text.match(/--effort <level> .*?\(([a-z, ]+)\)/)?.[1];
  const efforts = effortList ? effortList.split(',').map((level) => level.trim()).filter(Boolean) : FALLBACK_EFFORTS;
  return {
    models: aliases.map((alias) => ({ id: alias, label: `${alias.charAt(0).toUpperCase()}${alias.slice(1)} (latest)`, efforts })),
    efforts,
  };
}

// Turns `claude -p --output-format stream-json --include-partial-messages` events into provider events.
export class ClaudeStreamParser {
  sessionId?: string;
  finished = false;
  #cwd: string;
  #wroteText = false;
  #needsBreak = false;
  #modelUnavailable = false;

  constructor(cwd: string) {
    this.#cwd = cwd;
  }

  // Returns provider events for one CLI event. Permission requests are handled by the caller.
  handle(event: any): ProviderEvent[] {
    if (typeof event.session_id === 'string') this.sessionId = event.session_id;
    switch (event.type) {
      case 'stream_event':
        // Subagents stream too; only show the main conversation's text.
        return event.parent_tool_use_id ? [] : this.#streamEvent(event.event);
      case 'system':
        return event.subtype === 'init' && typeof event.model === 'string' ? [{ type: 'model', model: event.model }] : [];
      case 'assistant':
        // An unknown or inaccessible --model arrives as a synthetic assistant message, then an error result.
        if (event.error === 'model_not_found') this.#modelUnavailable = true;
        return (event.message?.content ?? [])
          .filter((block: any) => block.type === 'tool_use')
          .map((block: any) => ({ type: 'tool', name: toolLabel(block.name), detail: this.#toolDetail(block.input ?? {}) }));
      case 'result':
        this.finished = true;
        if (event.is_error || event.subtype !== 'success') {
          const text = typeof event.result === 'string' && event.result ? event.result : `Claude Code stopped (${event.subtype}).`;
          return [{ type: 'error', message: withLoginHint(text), ...(this.#modelUnavailable && { modelUnavailable: true }) }];
        }
        return [{ type: 'done', cancelled: false }];
      default:
        return [];
    }
  }

  #streamEvent(event: any): ProviderEvent[] {
    if (event?.type === 'message_start') {
      this.#needsBreak = this.#wroteText;
      return [];
    }
    if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      const text = (this.#needsBreak ? '\n\n' : '') + event.delta.text;
      this.#needsBreak = false;
      this.#wroteText = true;
      return [{ type: 'text', text }];
    }
    return [];
  }

  #toolDetail(input: Record<string, unknown>): string {
    for (const key of ['file_path', 'path', 'pattern', 'query', 'q', 'url', 'description']) {
      const value = input[key];
      if (typeof value !== 'string') continue;
      return key.endsWith('path') && isAbsolute(value) && !relative(this.#cwd, value).startsWith('..')
        ? relative(this.#cwd, value) || '.'
        : value;
    }
    return '';
  }
}

function toolLabel(name: string): string {
  const mcp = name.match(/^mcp__(.+?)__(.+)$/);
  return mcp ? `${mcp[1]}: ${mcp[2]}` : name;
}

export function withLoginHint(message: string): string {
  return /not logged in|log ?in|authenticat|api key|unauthori[sz]ed/i.test(message)
    ? `${message}\nRun the CLI in a terminal and log in, then try again.`
    : message;
}
