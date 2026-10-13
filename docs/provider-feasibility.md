# Provider Feasibility (Phase 1)

Findings from October 12, 2026. Goal: confirm each provider can answer questions about attached files while **enforcing ask-only** (no workspace file modifications or Git mutations) through configuration, not prompt text. Attached-context-only access is not a goal (see [CLAUDE.md](../CLAUDE.md)).

## Environment

| Item | Version |
| --- | --- |
| OS | macOS 27.0.1 (26A434) |
| Claude Code | 2.1.296, logged in with a claude.ai subscription |
| Codex CLI | 0.160.0, logged in with ChatGPT |
| Node.js | 24.16.0 |

Both CLIs worked non-interactively with the existing login. No API keys were used.

## Summary

| | Claude Code | Codex |
| --- | --- | --- |
| Interface | `claude -p --output-format stream-json` (JSONL on stdout) | `codex exec --json` (JSONL on stdout) |
| Ask-only mechanism | Built-in tool list limited to read tools, plus the `dontAsk` permission mode | `--sandbox read-only` (OS sandbox) |
| Edits, new files, `git commit` | Blocked: the tools don't exist | Blocked by the sandbox (EPERM) |
| Reads unattached files | Yes (Read/Grep/Glob) | Yes (shell `cat`/`rg`) |
| Shell commands | None (Bash removed) | Allowed, inside the read-only sandbox |
| MCP tools | Kept (per-server allow rules); side effects are an accepted risk | Kept; the write attempted via `node_repl` failed with EPERM; plugins are an accepted risk |
| Token streaming | Yes (`--include-partial-messages`) | No: whole messages only (token deltas need the experimental `codex app-server`) |
| Cancellation | SIGTERM; the process exits, nothing left behind | SIGTERM; the process exits, nothing left behind |

**Recommendation:** implement **Claude Code first**. Its tool restriction holds no matter what the model tries, it streams tokens, and it reports denied tool calls. Codex is also viable. Before building its adapter, decide between `exec --json` (simple, no token streaming) and `app-server` (streams tokens but is experimental).

## Claude Code

### Ask-mode invocation

```sh
claude -p --output-format stream-json --verbose --include-partial-messages \
  --no-session-persistence --permission-mode dontAsk \
  --tools "Read,Grep,Glob,WebFetch,WebSearch,Agent,ToolSearch" \
  --allowedTools "Read,Grep,Glob,WebFetch,WebSearch,Agent"
```

The prompt goes in on **stdin**. `--tools` and `--allowedTools` accept a variable number of values, so they swallow a prompt passed as a trailing argument.

- `--tools` sets which built-in tools exist. Edit, Write, NotebookEdit, Bash, EnterWorktree, Cron*, RemoteTrigger, Workflow and Skill are removed entirely, so the model can't find them through `ToolSearch` either.
- `dontAsk` denies any tool not on the allow list rather than prompting. With only the flags above, MCP tools are blocked unless the user's own settings allow them.
- Subagents (`Agent`) inherit the same restricted tool set.

**MCP tools (owner decision: keep them all).** Ask mode should keep every MCP tool available. A wildcard `mcp__*` allow rule does **not** work: the call was still denied. A rule per server does work: `mcp__local-searxng` allowed `mcp__local-searxng__search_web`. So the adapter must add one `mcp__<server>` rule per configured server to `--allowedTools`. Server names are normalized in tool names (`claude.ai Claude Docs` → `mcp__claude_ai_Claude_Docs__*`). How to discover servers before launch (`claude mcp list`, or the `init` event's tool list) is to be decided in Phase 4.

**Phase 4 resolution:** no discovery is needed. The adapter runs with `--input-format stream-json --permission-mode default --permission-prompt-tool stdio`. The CLI then sends each permission prompt to the extension as a `control_request` (`can_use_tool`). The extension answers `allow` for read tools and any `mcp__*` tool, and `deny` for everything else. The hard boundary is still `--tools`: write tools don't exist, regardless of what the extension answers. (A plain `claude -p` in stream-json input mode emits no `init` event until it receives the first message, so the `init` event's server list isn't available without a model call. Control requests are answered without a message, though; see "Model and effort" below.)

### Tests

These ran in a throwaway Git fixture (`src/calc.py`, plus `src/helper.py` containing a unique marker). After each run I checked the outcome with `git status`, `git log`, `git worktree list` and file hashes, not just the model's reply.

1. **Deny list only** (`--disallowedTools Edit,Write,NotebookEdit,Bash`, dontAsk): edit, new file and commit were all blocked. The model tried a subagent, which was also blocked. Gap: `EnterWorktree`, `CronCreate`, `RemoteTrigger` and `Workflow` were still listed. That led to the `--tools` approach above.
2. **Final configuration**: the model read the unattached `helper.py` marker. Requests to edit, create a file, create a worktree, schedule a cron job and commit all failed. `ToolSearch` found none of the write tools, the subagent had the same tools, and an MCP call was denied (it appeared in `permission_denials`). The repository was unchanged.
3. **Prototype** `prototypes/claude-ask.mjs` with two attachments (a whole file and a line range) answered correctly from them and streamed text deltas. The fixture was unchanged.
4. **Cancellation**: SIGINT after 20 s (about 2.9 KB streamed). The prototype sent SIGTERM, the provider exited, and no process was left.

### Limitations

- **Accepted risk: MCP tools can have side effects.** Ask mode keeps all MCP tools (owner decision). An MCP server that writes files (for example a filesystem server) can modify the workspace, and remote MCP tools such as Claude Docs `update`/`delete` can change external services. The ask-only guarantee covers Claude Code's built-in tools only. User-facing docs must say this.
- No shell, so read-only commands such as `git log` and `git diff` are unavailable. Consider allowing specific read-only Bash patterns later.
- Hooks configured in user settings still run (they are user-authored).

## Codex

### Ask-mode invocation

```sh
codex exec --json --ephemeral --sandbox read-only -C <workspace> -
```

The prompt goes in on stdin (`-`). `--ephemeral` avoids saving session files.

### Tests

1. **Read-only sandbox**: the model read the unattached `helper.py` marker. `apply_patch` was rejected ("writing is blocked by read-only sandbox"), shell writes and a Python write got `Operation not permitted`, `git commit` couldn't create `.git/index.lock`, and `fs.writeFileSync` through the `node_repl` MCP server got `EPERM`. The repository was unchanged.
2. **Prototype** `prototypes/codex-ask.mjs` with the same attachments answered correctly. The fixture was unchanged.
3. **Cancellation**: SIGINT after 20 s. Nothing had streamed yet because there are no token deltas. The provider exited and no process was left.

### Limitations

- **Accepted risk: plugins and MCP servers may act outside the sandbox.** User config is kept as-is (owner decision). The user config enables computer-use and browser plugins. GUI automation could in principle edit files through another app, regardless of the file sandbox. The `node_repl` MCP write was blocked in this test, but that is an observation, not a documented guarantee. The ask-only guarantee covers Codex's shell, `apply_patch` and Git only. User-facing docs must say this.
- No token streaming in `exec --json`. The UI would show progress (commands, tool calls) and then whole messages.
- Shell sandbox side effects: some tools print warnings because temp-file creation is denied (for example the `xcrun` cache). Harmless for reading.

## Codex app-server (October 13, 2026)

ContextBridge now talks to Codex over `codex app-server --stdio` (JSON-RPC, one server per question) by default. `exec --json` remains available as `contextBridge.codex.transport: "exec"`.

- **Streaming:** text arrives as `item/agentMessage/delta` (52 deltas for a short answer in the first probe).
- **Ask mode:** `thread/start` / `thread/resume` with `sandbox: "read-only"` and `approvalPolicy: "never"`. `npm run test:boundary -- codex` passed in new and resumed conversations: Codex ran `git checkout -b attack && git commit` twice, and the repo, `.git` included, was unchanged.
- **Agent mode:** `sandbox: "read-only"`, `approvalPolicy: "on-request"`. Write attempts arrive as `item/commandExecution/requestApproval` (or `item/fileChange/requestApproval`) and become Allow/Deny cards. Live: declined left the file unchanged, accepted edited it, and a follow-up resumed the thread with context.
- **Cancel:** `turn/interrupt`, then the server is stopped. No `app-server --stdio` or MCP (`node_repl`) processes were left behind.
- The `codex app-server --listen unix:// --managed-daemon` process seen on the test machine is Codex's own shared daemon, already running before any app-server work. It isn't started or stopped by ContextBridge.

## Model and effort (October 13, 2026)

Checked with Claude Code 2.1.296 and Codex CLI 0.162.1. These are the interfaces behind the model and effort pickers. None of them sends a message, so none makes a model call.

**Claude Code.** In `claude -p --input-format stream-json --output-format stream-json --verbose`, control requests are answered right away, before any user message:

- `initialize` returns `models`: each has `value` (the `--model` argument, e.g. `opus` or `claude-opus-4-6`), `resolvedModel`, `displayName`, and `supportedEffortLevels` (absent for models without effort control, e.g. Haiku 4.5). The `value: "default"` entry is the account default, **not** a `model` from the user's settings.
- `get_settings` returns `applied: { model, effort }`, the model and effort that will actually be used. It includes user and project settings and `--model`/`--effort` (e.g. `{}` → `claude-opus-5-5`/`medium`; `--model claude-opus-4-6` → `high`; Haiku 4.5 → effort `null`). This request isn't in Claude Code's public docs, so if it stops working, the footer falls back to the `init` event's `model` and the requested effort.
- Neither request created a session file. Unknown subtypes get an `error` response (`Unsupported control request subtype`).
- `--model <unknown>` fails the turn: an assistant message with `error: "model_not_found"`, then a `result` with `is_error: true`. An unknown `--effort` value prints a warning and is ignored.

**Codex app-server.**

- `model/list` (paged with `nextCursor`) returns each model's `model` id, `displayName`, `hidden`, `isDefault`, `defaultReasoningEffort`, and `supportedReasoningEfforts`.
- `config/read` with `cwd` returns the effective config, including project layers. `model` and `model_reasoning_effort` are `null` when unset.
- `thread/start` / `thread/resume` take `model`. `turn/start` takes `model` and `effort`, which apply to that turn and later ones. The thread response reports `model` and `reasoningEffort` (`null` when unconfigured). No notification reports the effort a turn actually used.
- An unsupported model fails the turn with an API error passed through as JSON text: `The '<model>' model is not supported when using Codex with a ChatGPT account.`

**Both CLIs silently accept an effort the model doesn't support.** Codex ran GPT-6-Luna with `ultra`, which isn't in its supported list, over both app-server and exec, with no warning. So ContextBridge checks the effort against the CLI's list before sending.

## Not Yet Checked

- Whether grandchild processes (MCP servers) outlive a cancelled Codex run. Only the direct child was checked.
- Follow-up questions: resolved in Phase 4 with `--resume <session_id>` (Claude) and `codex exec resume <thread_id>` (Codex). A resumed Codex session stayed read-only (`-c sandbox_mode="read-only"`, because `resume` has no `--sandbox` flag): edit, new file and commit were all blocked.
- Behavior with a large number of attachments, or large ones.

## Reproduction

```sh
node prototypes/claude-ask.mjs --cwd <dir> --attach src/calc.py --attach src/helper.py:2-3 -- "Why does mean() crash on empty input?"
node prototypes/codex-ask.mjs  --cwd <dir> --attach src/calc.py --attach src/helper.py:2-3 -- "Why does mean() crash on empty input?"
```

To repeat the boundary check with the shipped adapters (Phase 5), run `npm run test:boundary` (optionally `-- claude` or `-- codex`). It asks each provider, in a throwaway Git repo, to edit, create and delete files, create a branch and commit, once in a new conversation and once in a resumed one. It fails unless the repo, `.git` included, is byte-for-byte unchanged. Last run (October 12, 2026): passed for both providers in both conversations.
