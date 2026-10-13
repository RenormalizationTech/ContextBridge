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

Layout: `src/context/` (attachments and prompt assembly), `src/chat/` (webview chat view), `src/providers/` (provider adapters; currently a mock). `prototypes/` holds the Phase 1 CLI scripts.
