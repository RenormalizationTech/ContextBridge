# Changelog

## 0.3.2 — 2026-10-19

- Keep your place while scrolled up during a streaming answer; the chat follows new output only when you are at the bottom.
- Keep unsent text in the question box when you switch to another view in the side bar and back.

## 0.3.1 — 2026-10-14

- Add a teal-and-blue bridge/chat logo for the Marketplace listing and Extensions view.
- Include the updated installation instructions and real Ask-mode screenshot in the listing README.

## 0.3.0 — 2026-10-14

- Publish to the Visual Studio Marketplace as **ContextBridge Chat**, ID `renormalizationtech.contextbridge-chat`.

- Add GitHub Copilot CLI through the official SDK, reusing its login and model catalog.
- Support streamed answers, resumed chats, model/effort selection, cancellation and Agent approval cards.
- Enforce Ask mode with per-turn read/search tool filtering and the existing checked Git tools.
- Remove Mock from the provider picker and settings; keep it as a test fixture.

## 0.2.1

- Show a live summary of uncommitted changes above the chat, with green additions and red deletions.
- Open changed files together in VS Code's multi-file diff editor.
- Attach the current editor file or selection automatically, with per-chat controls.
- Give Claude Code read-only Git tools in Ask mode.
- Document rebuilding and reinstalling VSIX packages after source changes.

## 0.2.0

- Add model and reasoning-effort pickers using the provider CLIs' available models and settings.
- Remember choices per chat and report the model and effort used for each answer.
- Handle unsupported efforts and unavailable models with visible feedback.

## 0.1.0

- Introduce Claude Code and Codex chat with explicit file and selection attachments.
- Add streaming, cancellation, enforced Ask mode and optional Agent mode with approvals.
- Save per-workspace chat history and resume provider conversations.
- Render Markdown, syntax-highlighted code and math, with copy controls.
