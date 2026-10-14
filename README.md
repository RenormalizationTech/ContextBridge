# ContextBridge

**Copilot-style chat for Claude Code, Codex and GitHub Copilot CLI.** Attach the files and code selections you care about, ask a question, and get an answer in the VS Code side bar. In **Ask** mode (the default), ContextBridge won't let the provider edit your files: it suggests, and you make the changes. Switch to **Agent** mode when you want the CLI's full capabilities back.

ContextBridge is a thin layer over the official `claude`, `codex` and `copilot` CLIs. It uses their existing login and subscription, and has no accounts, API keys or billing of its own.

## Requirements

- VS Code 1.100 or later, used locally. Remote SSH, containers and other remote setups aren't supported.
- At least one provider CLI, installed and logged in:
  - **Claude Code:** install `claude`, then run `claude` once in a terminal to log in.
  - **Codex:** install `codex`, then run `codex login`.
  - **GitHub Copilot:** install `copilot`, then run `copilot login`. Your account must have access to Copilot CLI.
- Tested on macOS with Claude Code 2.1.296 and Codex CLI 0.160.0, and Copilot CLI 1.0.98 (official SDK 1.0.22).

## Install

ContextBridge isn't on the Marketplace yet. Build and install a VSIX:

```sh
npm install
npm run package                # writes dist/contextbridge-<version>.vsix
code --install-extension dist/contextbridge-0.3.0.vsix
```

If `code` isn't on your PATH, open the Extensions view in VS Code, choose **⋯ → Install from VSIX…**, and pick the file.

To update an installed copy after source changes, rebuild and reinstall the VSIX, then run **Developer: Reload Window** in VS Code:

```sh
npm run package
code --install-extension dist/contextbridge-0.3.0.vsix --force
```

F5 builds the current source for the development host; it does not update the VSIX or your installed extension. An older VSIX can therefore be missing features even when its version is still `0.2.0`. Use the freshly packaged file when reinstalling.

Run `npm install` once in each fresh clone (and again after a `git pull` that changes `package.json`). Without it, building or pressing F5 fails with `Cannot find package 'esbuild'`. Newer npm versions may warn that `esbuild` and `@vscode/vsce-sign` have install scripts not yet approved. The build works without them, so you can ignore the warning, or approve them with `npm install-scripts approve <package>`.

## Uncommitted changes

When the workspace's Git repository has saved changes, a box above the conversation shows the changed-file count, additions in green, and deletions in red (for example **2 files +18 −2**). Click it to review the files together in VS Code's diff editor.

The summary includes staged, unstaged, and untracked files, comparing their current contents with the last commit. It refreshes about every three seconds while the chat is visible and after saving a file. Unsaved edits appear after saving; ignored files are excluded. Binary files count toward the file total but have no line counts. The summary hides when there are no changes or no Git repository. It uses the first workspace folder's repository, and does not attach the changes to your question automatically.

## Usage

1. Open the chat with **ContextBridge: Open**. It appears in the secondary (right) side bar, next to Copilot Chat if you use it. Use **View → Appearance → Secondary Side Bar** if it's hidden.
2. Pick **Claude Code**, **Codex**, or **GitHub Copilot**, and **Ask** or **Agent**, from the dropdowns. The line underneath shows whether the CLI was found and is logged in.
3. Attach context:
   - **Current file (automatic):** like Copilot, the file open in the editor is attached to each question. It appears as an outlined chip marked **current file**, which follows you as you switch files. Select text to send only the selection (the chip then says **selection**). Click **×** to leave it out of the current chat, and click the dimmed chip to bring it back. New chats start with it on; turn that off with `contextBridge.attachCurrentFile`. Only real files count: not settings, output panels or diff views. The model is told it was attached automatically, so questions about something else aren't steered toward it.
   - **+ button:** click **+** next to the attachments to search open editors and workspace files (select several), or to add the current selection.
   - **Files:** right-click files in the Explorer (multi-select works) or an editor tab and choose **Add File to ContextBridge**.
   - **Selections:** right-click selected code and choose **Add Selection to ContextBridge**. With nothing selected, it attaches the whole file.
4. Review the chips. Click one to open it (selections are highlighted), use **×** to remove one, or **Clear** to remove all.
5. Ask your question (**Enter** sends, **Shift+Enter** adds a new line). Press **Cancel** to stop.

Your questions appear in a shaded box, and answers carry the provider's name. While an answer is in progress, a light sweeps around the input box, and a spinner line at the end of the answer shows what the provider is doing and how long it's taken (for example `Read src/calc.py… 4s`). When the answer ends, the line becomes **Done in 14s**, **Cancelled after 5s**, or **Stopped** with the error. An answer keeps running if you switch to another view (Explorer, Copilot Chat, …) and is all there when you come back. Answers are rendered as Markdown. Code blocks are syntax-colored (light and dark palettes follow your theme) and have a **Copy** button. The copy icon at the end of an answer (next to **Done in …**) copies the whole answer as raw Markdown. Math is typeset with KaTeX: `$…$` or `\(…\)` inline, and `$$…$$`, `\[…\]` or a ```` ```math ```` block for display equations. Dollar amounts like "$5 and $10" stay as text, and TeX that can't be parsed is shown as a small inline error. Follow-up questions continue the same conversation. **New chat**, or switching providers, starts a fresh one.

### Model and effort

Two dropdowns below the question box pick the model and reasoning effort for the current chat:

- **Default** passes nothing to the CLI, so your own Claude Code or Codex configuration decides, as in the terminal. For Claude Code and Codex, the brackets show what that currently is, for example **Default (Opus 5.5)** and **Default effort (medium)**, read from the CLI with your settings applied (Claude Code's `get_settings`; Codex's `config/read` and model list). The default effort follows the selected model.
- **Copilot defaults:** Default model/effort use the CLI configuration. The SDK cannot identify the configured default before a prompt initializes it, so the picker leaves that label generic. Choose a specific model to select its supported effort levels.
- **The lists come from the CLIs.** Claude Code: its `initialize` response (aliases such as Opus and Sonnet, which track the latest model of that family, plus specific versions). Codex: `model/list`, the models your account can use. Copilot: the official SDK model catalog, including account policy and supported efforts. Each model offers only the effort levels the CLI says it supports. A model without effort levels shows a disabled **No effort levels** picker. **Other…** takes any model name the CLI accepts.
- **Unsupported efforts are never sent silently.** Claude Code and Codex can quietly ignore an effort the model doesn't support, so ContextBridge leaves it out and says so in the chat ("GPT-6-Luna doesn't support "ultra" effort, so it uses its default effort (medium)"). Switching to a model that lacks the chosen effort resets it to Default, with a notice. This can only come up for an effort from settings or history, since the picker doesn't offer unsupported levels.
- **The footer shows what answered:** the model as the CLI reports it (for example `claude-sonnet-5-5`) and its effort. For Claude Code this is the effort it actually applied. An effort ContextBridge couldn't confirm, such as one sent with a typed-in model, is marked **(requested)**.

Because the lists come from the CLIs, new models appear after you update the CLI, with no ContextBridge update. The lists and defaults are re-read for each new chat. Each chat remembers its choice (also when reopened from History), and the last one you picked becomes the default for new chats with that provider (`contextBridge.claude.model`, `contextBridge.claude.effort`, `contextBridge.codex.model`, `contextBridge.codex.effort`, `contextBridge.copilot.model`, `contextBridge.copilot.effort`). Changing the model mid-chat applies from the next question and keeps the conversation. If the CLI rejects a model (retired, misspelled, or not on your plan), the chat says so and switches to the default model. The model and effort don't affect what Ask mode allows.

### Chat history

Click **History** (or run **ContextBridge: Show Chat History**) to reopen a previous chat. Follow-up questions continue the same provider conversation. Use the trash icon to delete a chat, or **ContextBridge: Clear Chat History** to delete them all.

- **Where:** like Copilot Chat, each chat is one JSON file in VS Code's per-workspace extension storage (on macOS, `~/Library/Application Support/Code/User/workspaceStorage/<workspace-id>/contextbridge-dev.contextbridge/chats/`). The file holds your questions, the names of the files you attached (not their contents), and the answers and activity.
- **How long:** the 50 most recent chats per workspace are kept, and older ones are deleted automatically. Change this with `contextBridge.history.maxChats`; `0` turns history off. Copilot Chat, by contrast, keeps chats until you delete them.
- The CLIs keep their own copies of conversations and clean them up on their own schedule (Claude Code deletes sessions after 30 days by default). If you reopen a chat whose CLI conversation is gone, ContextBridge says so, and your next question starts a new conversation.

### How attachments behave

- A file's current content, including unsaved edits, is read **when you send**. A selection is a snapshot taken **when you attach it**. The current file and its selection are both read when you send.
- If you also attach the current file by hand, it's sent once.
- Every question re-sends the current attachments. The files sent are listed under each question.
- A file over 256 KB, content beyond 1 MB in total, or a file missing at send time is sent as a path-only reference, and the chat tells you. Binary files and folders are refused.
- **Attachments set the focus; they don't restrict access.** The provider can still read other files in your workspace, as it would from the terminal.

## Ask and Agent modes

Switch with the **Ask / Agent** dropdown, or the `contextBridge.mode` setting. Switching keeps the conversation going; the next question runs with the new mode's permissions.

| | Ask (default) | Agent |
| --- | --- | --- |
| Claude Code | Read and search tools only (see below) | Full tool set. Edits, commands and other actions pause with an **Allow / Deny** card in the chat. Allow rules in your Claude settings still auto-approve what you've already trusted. |
| Codex | Read-only sandbox; Codex can't ask for more | Read-only sandbox, but Codex can ask to do more. Edits and commands that need write access pause with an **Allow / Deny** card in the chat. |
| GitHub Copilot | Read/search tools and ContextBridge's read-only Git tools; local edits, shell and subagents are unavailable | Full tool set through the SDK; edits, commands and other permission requests pause with **Allow / Deny** cards. |

A banner shows while Agent mode is on. Cancelling while an approval card is waiting counts as **Deny**.

**Permission level (Agent mode):** like Copilot's permissions picker, a dropdown below the question box sets how approvals work for the current chat:
- **Default Permissions:** each edit, command or tool call the provider asks about pauses with an approval card.
- **Bypass Approvals:** every request is approved automatically. Each one is still listed in the chat, and the banner turns red. Turning it on shows a confirmation, which you can dismiss for good with "Don't Ask Again". The CLIs' own deny rules (for example in your Claude settings) still apply. Copilot managed policy can require an explicit approval card even with Bypass or Always allow.

Each chat remembers its level, including when reopened from History. New chats start at `contextBridge.agent.defaultPermissions` (default: Default Permissions).

Approval cards offer **Allow**, **Always allow** and **Deny**. **Always allow** lasts only for the current chat, and is never saved or written to your CLI settings. It covers all file edits when you use it on an edit, or that exact command when you use it on a shell command (for MCP and other tools, that tool). Each action it approves still shows a line in the chat. **New chat** or opening another chat resets it.

**Codex connection:** ContextBridge talks to Codex through `codex app-server`, which streams answers and supports approval cards. The Codex CLI marks it experimental. If it misbehaves after a Codex update, set `contextBridge.codex.transport` to `exec` to use the older `codex exec --json` connection. With `exec`, answers arrive as whole messages, and Agent mode runs in the `workspace-write` sandbox without asking. That allows edits in the workspace and Codex's default temp directories (`/tmp`, `$TMPDIR`), but nowhere else.

## What Ask mode guarantees

Ask mode is enforced through each CLI's own configuration, not just by asking the model nicely:

| | Claude Code | Codex | GitHub Copilot |
| --- | --- | --- | --- |
| How | Read/search tools only; other permission requests are denied | Read-only sandbox with approvals disabled, including follow-ups | Per-session read/search tool list; built-in edit, shell and subagent tools unavailable. Reapplied on every follow-up; other built-in action requests are denied |
| Can read and search workspace files | Yes | Yes, including read-only shell commands | Yes |
| Can read Git history and diffs | Through ContextBridge's `git_status`, `git_diff`, `git_log` and `git_show` tools | With read-only Git commands in the sandbox | Through the same four checked Git tools |
| Can search the web | Yes | Yes, through configured Codex web search | Through available web-fetch and MCP tools; availability depends on Copilot's runtime and account |
| Can edit, create or delete workspace files, or mutate Git | No | No | No |

**Not covered:** your own **MCP servers** (Claude Code and Copilot) and **plugins** (Codex) stay available, because ContextBridge keeps each CLI's capabilities. They run with whatever access they have, so an MCP server that writes files or updates an external service, or a Codex computer-use plugin, can still have side effects. If that matters to you, remove or disable them in the CLI's own configuration.

**Git in Claude Code's Ask mode:** rather than the shell, ContextBridge gives Claude Code four tools of its own (`git_status`, `git_diff`, `git_log`, `git_show`). They show up in the chat as the git command they ran, for example `git diff --cached`. They build the git command themselves from checked arguments, so nothing else can run: no options like `--output`, no external diff programs, and no index refresh. The shell stays off because allow rules in your Claude settings would apply to it before ContextBridge could check the command. Ask about your own uncommitted work ("what did I change since my last commit?") or history ("what changed in the last three commits?").

Conversations are saved by each CLI like any other session (for example, they appear in Claude Code's `/resume` list). Details and test evidence: [docs/provider-feasibility.md](docs/provider-feasibility.md).

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `contextBridge.provider` | `claude` | `claude`, `codex`, or `copilot` |
| `contextBridge.mode` | `ask` | `ask` or `agent` |
| `contextBridge.attachCurrentFile` | `true` | Attach the file open in the editor (or its selection) to each question |
| `contextBridge.agent.defaultPermissions` | `default` | Agent-mode level for new chats: `default` (Default Permissions) or `bypass` (Bypass Approvals) |
| `contextBridge.claude.model`, `contextBridge.codex.model`, `contextBridge.copilot.model` | empty | Model for new chats (empty: the CLI's default). Set by the model picker |
| `contextBridge.claude.effort`, `contextBridge.codex.effort`, `contextBridge.copilot.effort` | empty | Effort for new chats (empty: the CLI's default). Set by the effort picker |
| `contextBridge.history.maxChats` | `50` | Chats kept per workspace; `0` turns history off |
| `contextBridge.claude.path` | empty | Path to `claude` if it isn't found automatically |
| `contextBridge.codex.path` | empty | Path to `codex` if it isn't found automatically |
| `contextBridge.copilot.path` | empty | Path to `copilot` if it isn't found automatically |
| `contextBridge.codex.transport` | `app-server` | `app-server` (streams, approval cards) or `exec` (fallback) |
| `contextBridge.codex.webSearch` | `live` | Codex web search: `live` (current pages), `cached` (OpenAI's index, may be slightly stale), or `disabled` |

## Troubleshooting

- **Only one CLI installed:** that's fine. If the selected provider isn't installed when the chat first opens, ContextBridge switches to one that is and tells you.
- **"CLI not found":** ContextBridge looks in your login shell's PATH and the usual install locations (`~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, ...). If yours is elsewhere, set the path setting above (run `which claude` in a terminal to find it).
- **"Not logged in":** run `claude`, `codex login`, or `copilot login` in a terminal, then switch providers in the dropdown to refresh the status.
- **An MCP server fails to start:** ContextBridge passes your login shell's PATH to the CLI. Check that the server works when you run `claude` from a terminal.

## Development

Requirements: Node.js 22.12+ (developed on 24, also built on 26) and npm.

```sh
npm install
npm run check          # typecheck, unit tests (including fake-CLI adapter tests), build
npm run watch          # rebuild on change
npm run test:boundary  # live Ask-mode check against all three CLIs (uses your accounts)
npm run test:copilot   # live attachments/resume/approval/cancel check in a disposable repo
npm run package        # build a VSIX into dist/
```

Press **F5** in VS Code ("Run Extension") to start an Extension Development Host.

Layout:
- `src/context/`: attachments and prompt assembly.
- `src/chat/`: the chat view, host side.
- `src/webview/`: the chat webview script and Markdown rendering.
- `src/providers/`: the Claude Code, Codex and Copilot adapters; Mock is a test fixture only.
- `scripts/`: the live boundary check.
- `prototypes/`: the Phase 1 CLI scripts.

Project docs: [PROJECT_GOALS.md](PROJECT_GOALS.md), [TODO.md](TODO.md), [CLAUDE.md](CLAUDE.md). Release notes: [CHANGELOG.md](CHANGELOG.md). Marketplace preparation: [docs/publishing.md](docs/publishing.md).

## License

Apache License 2.0. See [LICENSE](LICENSE).
