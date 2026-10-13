# ContextBridge

A VS Code extension that brings a GitHub Copilot Ask-like experience to Claude Code and Codex, with explicit file and selection attachments and an ask-only product direction.

See [Project Purpose and Goals](PROJECT_GOALS.md) for the MVP scope, milestones, and access-boundary requirements.

See [Development TODO](TODO.md) for the implementation checklist and instructions for continuing from another machine.

## Development

Requirements: Node.js 22+ (developed on 24), npm, and VS Code 1.100+.

```sh
npm install
npm run check      # typecheck, unit tests, and build
npm run watch      # rebuild on change
```

To try the extension, open this folder in VS Code and press **F5** ("Run Extension"). In the Extension Development Host window, open a folder, then select the ContextBridge icon in the Activity Bar (or run **ContextBridge: Open**). Choose **Claude Code**, **Codex**, or **Mock** (canned answers) from the dropdown at the top of the chat. The line below it shows whether the CLI was found and is logged in.

### Providers

ContextBridge runs the official CLIs you already have installed and logged in. It has no accounts or API keys of its own.

- **Claude Code** (`claude`): answers stream as they're written. Ask mode starts it with only read and search tools (`Read`, `Grep`, `Glob`, `WebFetch`, `WebSearch`, `Agent`, `ToolSearch`), so it has no tool that can edit files or run shell commands.
- **Codex** (`codex`): runs `codex exec` in the read-only sandbox. Codex can run shell commands to read and search, but the sandbox blocks writes. Answers arrive as whole messages rather than streaming.
- Follow-up questions continue the same provider conversation, and every question re-sends the current attachments. **New chat** or switching providers starts a new conversation. Conversations are saved by the CLI like any other session.
- Answers are rendered as Markdown (raw HTML is shown as text, never rendered). Code blocks have a **Copy** button. Web links open in your browser, and relative links open workspace files.
- Settings: `contextBridge.provider`, and `contextBridge.claude.path` / `contextBridge.codex.path` if the CLI isn't found automatically.

**What Ask mode does and doesn't guarantee:** the providers' built-in file-editing, shell-write and Git tools are blocked. Your own MCP servers (Claude Code) and plugins (Codex) stay available, and they can have side effects that ContextBridge doesn't control. Examples are an MCP server that writes files or updates an external service, or a Codex computer-use plugin. Remove or disable those in the CLI's own configuration if that matters to you. See [docs/provider-feasibility.md](docs/provider-feasibility.md).

### Attachments

- **Add files:** right-click files in the Explorer (multi-select works) or an editor tab and choose **Add File to ContextBridge**, or run it from the Command Palette for the active file.
- **Add a selection:** right-click selected code and choose **Add Selection to ContextBridge**. With no selection, the whole file is attached.
- **Review:** click a chip to open the file (selections are highlighted); use × to remove one, or **Clear** to remove all.
- **Timing:** a file's current content, including unsaved edits, is read when you send. A selection is a snapshot taken when you attach it.
- **Limits:** a file over 256 KB, content beyond 1 MB in total, or a file missing at send time is sent as a path-only reference, and the chat says so. Binary files and folders are refused.
- Attachments set the focus of a question; they don't restrict access. The provider may still read other files in the workspace.

Layout: `src/context/` (attachments and prompt assembly), `src/chat/` (webview chat view host side), `src/webview/` (chat webview script and Markdown rendering), `src/providers/` (Claude Code, Codex and mock adapters). `prototypes/` holds the Phase 1 CLI scripts.
