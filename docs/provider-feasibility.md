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
- No shell. Read-only Git is provided instead by ContextBridge's own MCP server (`src/git/gitServer.ts`, added October 13, 2026): `git_status`, `git_diff`, `git_log` and `git_show`, passed with `--mcp-config` in Ask mode only. Allowing read-only Bash patterns was rejected: with Bash in the tool set, allow rules in the user's Claude settings (for example `Bash(git push:*)`) apply before the permission prompt reaches ContextBridge. The server builds each command from validated arguments (revisions and paths can't start with `-`), adds `--no-ext-diff --no-textconv`, and runs git with `GIT_OPTIONAL_LOCKS=0` and `core.fsmonitor=false`. A test runs it against a real repository and checks that files and `.git` are byte-for-byte unchanged, including a rejected `--output` attempt. Live: Claude found the tools through `ToolSearch` and answered "what did I change since my last commit?" from `git diff`, and `npm run test:boundary` (with an added git `--output` step) passed. Codex runs git through its read-only sandbox (`git status`, `git diff`, `git log` worked live).
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

## Antigravity CLI `agy` (October 13, 2026): feasibility spike, deferred

**Status: deferred (owner decision, October 13, 2026).** Not added to ContextBridge for now. The findings below are kept for a later attempt; see "Problems" and "When to revisit" at the end of this section.

Checked with `agy` 1.3.4 (Google Antigravity CLI, logged in with a Google account) on macOS, in throwaway Git repos. After every run the files and `.git` were hashed and compared.

**Interface.** `agy -p <prompt> --output-format stream-json` streams NDJSON:
- `init`, with `conversation_id` and the tool list;
- `step_update` events, with `text_delta`, tool steps (`tool_name`, `state`, errors) and usage;
- a final `result`.

`--conversation <id>` resumes a conversation. `agy models` lists the models (Gemini 3.8 Flash low/medium/high, Claude Sonnet/Opus 4.6, GPT-OSS 120B), and `--model`/`--effort` select them. Authentication stays with the CLI.

**Default headless behavior.** Tools that need a permission (`write_file`, `command`, `read_file` outside the workspace) are auto-denied, because "headless mode cannot prompt". The repo stayed unchanged, including with `--mode plan`. Two problems:
- A denial ends the turn with an empty response, so a model that tries even `ls` gives no answer.
- The denials depend on permission rules, so allow rules in the user's `agy` settings would let writes through.

**Read-only custom agent (the candidate Ask-mode boundary).** A Markdown agent in `~/.gemini/config/agents/` with `tools: [view_file, grep_search, find_by_name, list_dir]`, selected with `--agent <name>`. `--agent` doesn't accept a file path, so ContextBridge would have to install this file. The test agents were removed after the spike.
- **Writes blocked.** Edit, create, delete, `git checkout -b` and `git commit` attempts left the repo byte-for-byte unchanged in new and resumed conversations, **including with `--dangerously-skip-permissions`**. Told to call `write_to_file`, `run_command` and `invoke_subagent` by name, it reported having none of them. So the restriction comes from the agent's tool set, not from permission rules, and user allow rules can't widen it. The model's own tool list was the four tools plus `manage_task`, `agy`'s task-list tool, which `agy` always adds.
- **Questions answered.** It answered correctly and read an unattached file.
- **`excludeDefaultComponents: true` hurts answers.** It removes the prompt sections that say where the workspace is, so the model searched `/workspace` and `/`. One question then ended empty after an out-of-workspace read was denied. Without it, the `tools:` list alone still restricted the tool set, and the answers included file links. Adding the workspace path to the prompt also fixed it.
- The init event's `tools` lists the whole catalog even with a custom agent, so it can't be used as evidence of the restriction.

**Agent mode.** No approval protocol: stream-json input accepts only `user` messages ("stream input message event %q is not supported yet"). Approval cards like Claude's and Codex's aren't possible yet. Agent mode would have to rely on `agy`'s own permission rules or `--dangerously-skip-permissions`.

**Verdict.** Ask mode is feasible with an installed read-only agent (no `excludeDefaultComponents`). Open costs:
- ContextBridge writes one file into the user's global `agy` config.
- A denied out-of-workspace read can still end a turn with no answer, so the adapter must report that clearly.
- `agy`'s headless behavior changes often (see `agy changelog`), so `npm run test:boundary` would need an `agy` target.

Agent mode should wait for an approval protocol.

**Problems (why it's deferred).**
1. **The CLI is changing fast.** `agy changelog` at 1.3.4 lists 68 releases since 1.0.0 and 757 changes. About 47 touch headless `-p`/stream-json mode, about 46 touch permissions, and 17 touch custom agents. Several were behavior changes, not fixes:
   - the default `-p` timeout went from 5 minutes to unlimited;
   - error exit codes went from 1 to 3;
   - how denied permissions are handled changed;
   - custom agents now inherit skills, rules and subagents by default;
   - three search tools were dropped from the default tool set but stay available to agents that list them.

   `agy` also updates itself: the binary and `~/.gemini/config/` (a `.migrated` marker) changed during the spike. An update could silently change what the read-only agent can do.
2. **The Ask-mode boundary needs a file in the user's global config.** `--agent` accepts only installed agents (`~/.gemini/config/agents/` or a project's `.agents/agents/`), not a file path. Writing into the workspace is out, so ContextBridge would have to install and maintain a file in `agy`'s global config.
3. **A denied action ends the turn with an empty answer.** Headless mode can't prompt, so any permission request (even reading outside the workspace) is auto-denied, and the turn often ends with no response. Questions can come back blank.
4. **`excludeDefaultComponents: true` makes answers worse.** It removes the workspace context, and the model searched `/` and `/workspace`. Leave it out and rely on the `tools:` list, which passes the boundary tests only for the version tested.
5. **The init event can't prove the restriction.** Its `tools` field lists the whole catalog even under a custom agent, so the adapter can't check the active tool set the way Claude's `--tools` can be relied on. Only the live boundary check shows it.
6. **No approval protocol, so no Agent mode.** stream-json input accepts only `user` messages; other events are "not supported yet". Allow/Deny cards aren't possible. The only options are `agy`'s own permission rules or `--dangerously-skip-permissions`.
7. **`agy`'s own task-list tool is always present.** `manage_task` appears in the model's tool set even under a custom agent's `tools:` list. It writes to `agy`'s own state, not the workspace, but it's a tool ContextBridge can't remove.

**When to revisit.**
- `agy` gains a way to answer permission requests over stream-json (needed for Agent mode).
- A per-run way to set the tool set or a read-only mode (a flag, or `--agent` accepting a file path), so no global config file is needed.
- Headless and permission entries in the changelog slow down across several releases.

Before building, rerun this spike on the then-current version, with the same attempts plus `--dangerously-skip-permissions`, hashing files and `.git`. Then add an `agy` target to `npm run test:boundary`. If it's built before all three hold, ship it as an experimental, off-by-default, Ask-only provider that refuses to run on an `agy` version newer than the last one the boundary check passed on.

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
