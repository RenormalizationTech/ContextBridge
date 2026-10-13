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

To try the extension, open this folder in VS Code and press **F5** ("Run Extension"). In the Extension Development Host window, open a folder, then select the ContextBridge icon in the Activity Bar (or run **ContextBridge: Open**). The chat currently uses a mock provider.

### Attachments

- **Add files:** right-click files in the Explorer (multi-select works) or an editor tab and choose **Add File to ContextBridge**, or run it from the Command Palette for the active file.
- **Add a selection:** right-click selected code and choose **Add Selection to ContextBridge**. With no selection, the whole file is attached.
- **Review:** click a chip to open the file (selections are highlighted); use × to remove one, or **Clear** to remove all.
- **Timing:** a file's current content, including unsaved edits, is read when you send. A selection is a snapshot taken when you attach it.
- **Limits:** a file over 256 KB, content beyond 1 MB in total, or a file missing at send time is sent as a path-only reference, and the chat says so. Binary files and folders are refused.
- Attachments set the focus of a question; they don't restrict access. The provider may still read other files in the workspace.

Layout: `src/context/` (attachments and prompt assembly), `src/chat/` (webview chat view), `src/providers/` (provider adapters; currently a mock). `prototypes/` holds the Phase 1 CLI scripts.
