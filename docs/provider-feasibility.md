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

**Phase 4 resolution:** no discovery is needed. The adapter runs with `--input-format stream-json --permission-mode default --permission-prompt-tool stdio`. The CLI then sends each permission prompt to the extension as a `control_request` (`can_use_tool`). The extension answers `allow` for read tools and any `mcp__*` tool, and `deny` for everything else. The hard boundary is still `--tools`: write tools don't exist, regardless of what the extension answers. (A plain `claude -p` in stream-json input mode emits no `init` event until it receives the first message, so probing for servers without a model call isn't possible.)

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

## Not Yet Checked

- Whether grandchild processes (MCP servers) outlive a cancelled Codex run. Only the direct child was checked.
- Follow-up questions: resolved in Phase 4 with `--resume <session_id>` (Claude) and `codex exec resume <thread_id>` (Codex). A resumed Codex session stayed read-only (`-c sandbox_mode="read-only"`, because `resume` has no `--sandbox` flag): edit, new file and commit were all blocked.
- Behavior with a large number of attachments, or large ones.
- Codex `app-server` protocol (`codex app-server generate-ts`) for streaming.

## Reproduction

```sh
node prototypes/claude-ask.mjs --cwd <dir> --attach src/calc.py --attach src/helper.py:2-3 -- "Why does mean() crash on empty input?"
node prototypes/codex-ask.mjs  --cwd <dir> --attach src/calc.py --attach src/helper.py:2-3 -- "Why does mean() crash on empty input?"
```
