# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What ContextBridge Is

A VS Code extension that is essentially "GitHub Copilot Ask mode for Claude Code and Codex":

- A **"+" attach** workflow (Explorer files, editor selections) to point the model at specific targets instead of the whole project.
- An **ask-only** mode (the default): the model answers and suggests; the user makes code changes by hand. An optional **Agent** mode restores the CLIs' full capabilities.
- A **thin layer over the official CLIs**. It wraps Claude Code and Codex, reusing their own authentication, subscriptions, and capabilities. It is not a new agent runtime.

Product details and milestones: [PROJECT_GOALS.md](PROJECT_GOALS.md). Implementation checklist and handoff notes: [TODO.md](TODO.md).

## Owner Decisions (October 12, 2026)

PROJECT_GOALS.md and TODO.md have been updated to match these. If they ever conflict, these decisions win.

1. **Motivation.** The official extensions and CLIs operate at whole-project scope and tend to change a lot of code when the user only wants suggestions. ContextBridge provides targeted context plus ask-only answers.
2. **Attachments focus; they do not isolate.** Attached files and selections are the model's primary context, but the provider may still read other files. Attached-context-only access is **not** a goal or a guarantee. Do not build heavy isolation for it, and never claim it in docs or UI.
3. **The hard boundary is ask-only.** In Ask mode the provider must not modify workspace files. Enforce this through provider configuration (tool permissions, sandbox or permission modes), not prompt instructions alone. Read-oriented capabilities (reading files, search) are acceptable.
4. **Keep provider capabilities.** Apart from the ask-only restriction, keep whatever each CLI offers rather than stripping it down. An action-capable mode exists only as the explicit, optional Agent mode (decision 9). This includes all MCP tools (Claude) and user plugins/config (Codex). They can have side effects outside the ask-only boundary, which is an accepted risk that must be documented for users, not engineered away. See `docs/provider-feasibility.md`.
5. **Providers.** Both are targeted, but start with whichever one is easier to integrate well. Shipping a single provider first is fine.
6. **Audience.** Personal use first. Publishing to the VS Code Marketplace is a later goal, so keep the code clean and packageable without over-investing in polish early.
7. **Environment.** Local VS Code only. Remote SSH, containers, and remote extension hosts are out of scope.
8. **Auth and billing.** Fully delegated to the Claude Code and Codex CLIs. No custom auth, API-key management, or billing.
9. **Optional Agent mode (added October 12, 2026).** An Ask/Agent switch in the chat, with Ask as the default (`contextBridge.mode`). Agent mode restores full CLI functionality:
   - Claude Code keeps its default tool set. Its permission prompts appear in the chat as Allow/Deny cards, and the user's Claude settings allow rules still apply.
   - Codex talks over `codex app-server` by default (setting `contextBridge.codex.transport`). Agent mode is a read-only sandbox with approval `on-request`, so edits and commands that need write access show Allow/Deny cards, like Claude Code (owner decision, October 13, 2026).
   - The `exec` fallback transport can't ask for approvals. In Agent mode it uses `workspace-write`, which covers the workspace plus Codex's default temp dirs.
   - Agent mode has a per-chat permission level, like Copilot's picker: Default Permissions (approval cards) or Bypass Approvals (everything auto-approved and listed in the chat; a confirmation the first time). The level is saved with the chat, and new chats start from `contextBridge.agent.defaultPermissions`.
   - Ask mode's enforcement is unchanged. Switching modes keeps the conversation.
   - The chat lives in the secondary (right) side bar.

## Working Conventions

- Keep the separation between context collection, chat/UI, and provider adapters.
- Prefer structured CLI or SDK interfaces over scraping terminal output.
- Update TODO.md's handoff section at the end of a work session. Only mark items done after they have been verified.
