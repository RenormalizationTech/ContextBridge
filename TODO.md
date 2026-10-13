# ContextBridge Development TODO

This is the handoff checklist for continuing development on another machine. Product scope and principles are in [PROJECT_GOALS.md](PROJECT_GOALS.md).

## Current State

- [x] Choose ContextBridge as the project name.
- [x] Define the product direction: one VS Code extension, Claude Code and Codex adapters, explicit attachments, Ask mode.
- [x] Document MVP goals and milestones.
- [ ] Implement the extension. The Phase 2 scaffold exists (mock provider only).

**Next task:** Phase 5 (verify and release); consider Markdown rendering of answers.

## Continue on Another Machine

```sh
git clone https://github.com/RenormalizationTech/ContextBridge.git
cd ContextBridge
git switch provider-feasibility   # or the current development branch
```

For an existing checkout, inspect `git status` and save any local work before updating it with `git pull --ff-only` on the appropriate branch. Reuse an existing development branch when continuing unfinished work.

- [ ] Read `README.md`, `PROJECT_GOALS.md`, and this file.
- [x] Install Git and the development tools needed for the next task. Supported versions: Node.js 22+ (developed on 24.16), npm, VS Code 1.100+ (developed on 1.141).
- [x] Install and authenticate the provider CLIs on the machine where they will run, using their supported account workflows.
- [x] Record the operating system and exact CLI versions used for feasibility checks (see `docs/provider-feasibility.md`).
- [x] Decide the development environment: local VS Code only (remote extension hosts are out of scope). A headless machine can still run prototype checks.
- [x] Once the scaffold exists, document dependency installation, build, test, and extension-debug commands in the README.

“Continue on another machine” means continuing development from this Git repository. Remote execution and remote provider hosting are out of scope.

## Phase 1 — Provider Feasibility and Ask-Only Boundary

- [x] Check Claude Code and Codex programmatic interfaces, authentication, streaming, cancellation, and permission controls (from CLI help and live tests).
- [x] Create a small prototype for each provider that accepts a question and explicit context, then streams an answer.
- [x] Verify that existing-account authentication works for each integration; document prerequisites and any subscription limitations.
- [x] Identify the permission settings or sandbox modes that block file modifications and Git mutations while keeping read and search capabilities.
- [x] Verify the boundary with attempted file modifications and Git mutations. Inspect tool/access events where supported; refusal text alone is not proof.
- [x] Check how user-level provider settings and enabled integrations (for example MCP servers) could weaken the boundary. Decision: keep all MCP tools and plugins and document the risk (see limitations).
- [x] Decide which provider to implement first: Claude Code (recommended in the feasibility doc).
- [x] Save findings, tested versions, reproduction commands, and unresolved limitations in `docs/provider-feasibility.md`.

**Done when:** At least one provider answers using the attached context, with evidence that file modifications are blocked in Ask mode. Attached-context-only access is not required (attachments focus but do not isolate). If the ask-only boundary cannot be enforced for a provider, record the blocker and defer that provider.

## Phase 2 — Extension Scaffold

- [x] Initialize a TypeScript VS Code extension with a package manifest, lockfile, build configuration, and extension-debug configuration.
- [x] Create separate modules for context collection, chat state/UI, and provider adapters.
- [x] Define shared request, attachment, streaming-event, error, and cancellation interfaces.
- [x] Add a command to open ContextBridge and a minimal chat view.
- [x] Add a mock provider so editor workflows can be developed without a live account.
- [ ] Define provider executable discovery for local VS Code (moved to Phase 4 with the Claude adapter).

**Done when:** A fresh checkout can install dependencies, build, and open ContextBridge in a VS Code Extension Development Host with a mock response.

## Phase 3 — Explicit Context

- [x] Add “Add to Context” for Explorer files.
- [x] Add the active editor selection with source path and line range.
- [x] Display attachments with preview and removal controls.
- [x] Define attachment snapshot behavior, including unsaved editor content and changes after attachment.
- [x] Handle duplicate attachments, missing files, unsupported/binary content, and oversized inputs.
- [x] Show context limits and require visible handling of omitted or truncated content.
- [x] Assemble a predictable request payload with clear source boundaries.

**Done when:** The user can inspect exactly which attachments will be sent, and the payload presents them clearly as the focus of the question. The UI does not imply the provider is restricted to them.

## Phase 4 — Provider Chat

- [x] Implement the Claude Code adapter using the validated Phase 1 approach.
- [x] Implement the Codex adapter using the validated Phase 1 approach (may follow the first provider's release).
- [x] Add provider selection and prerequisite/authentication status.
- [x] Render streaming answers and support cancellation and process cleanup.
- [x] Handle missing executables, authentication failures, connection failures, and provider errors.
- [x] Define follow-up history and provider-switching behavior; keep reused context visible.
- [x] Apply the verified ask-only restrictions to every request.
- [x] Render provider output safely and keep credentials and attached source content out of routine logs.

**Done when:** Supported providers handle the same file/selection question workflow, including cancellation and clear failures, without modifying workspace files.

## Phase 5 — Verify and Release

- [ ] Add meaningful checks for attachment payload correctness, provider event handling, cancellation, and the ask-only restriction.
- [ ] Manually verify file attachment, selection attachment, preview, removal, streaming, and follow-up behavior in VS Code.
- [ ] Repeat ask-only boundary checks with the actual extension and each supported provider.
- [ ] Verify setup from a fresh checkout on the second development machine; document any environment limitations.
- [ ] Document installation, reliance on the provider CLIs for authentication, usage, local-only support, and exact access behavior (ask-only enforced; attachments focus but do not isolate).
- [ ] Package an installable VSIX for personal use.
- [ ] Later: choose a publisher identity, create a short demonstration, and publish to the VS Code Marketplace.
- [ ] Compare the workflow with the official provider extensions and collect early-user feedback.

**Done when:** The packaged extension can be installed and the main workflow completed using the documentation, with no unsupported security or authentication claims.

## Later Backlog

- [ ] Open-tab attachments, Git diffs, and diagnostics.
- [ ] Context-size estimates and saved context sets.
- [ ] Persistent chat history and multi-root workspaces.
- [ ] Symbols/references and additional provider adapters.

Agent mode and automatic edits are outside the initial scope.

## Handoff Routine

At the end of each development session:

- [ ] Mark completed items only after their completion criteria have been verified.
- [ ] Update the next task and record blockers or decisions below.
- [ ] Record commands/checks actually run and their results; do not imply unperformed validation passed.
- [ ] Commit related changes and push the development branch so the next machine can retrieve them.

### Latest Handoff

- **Updated:** October 12, 2026 (branch `claude-adapter`).
- **Implemented:** Phase 4 provider chat.
  - Claude Code adapter: stream-json in/out, read-only `--tools`, permission prompts answered over stdio (allows read tools and all `mcp__*` tools), `--resume` follow-ups.
  - Codex adapter: `exec --json` with `sandbox_mode="read-only"`, `exec resume` follow-ups.
  - CLI discovery (setting, then login-shell PATH, then common install dirs), with the login-shell PATH passed to the child processes.
  - Status line (installed / logged in), provider dropdown, New chat, tool activity lines, the attachments sent shown under each question, cancellation, and errors for a missing CLI, logged-out state and early exit.
- **Next action:** Phase 5 (verify and release); consider Markdown rendering of answers.
- **Decided:** Ask mode keeps all MCP tools (Claude) and user plugins/config (Codex); their side effects are a documented, accepted risk. Follow-ups resume the CLI session and re-send current attachments; switching providers starts a new chat.
- **Open decisions:** Markdown rendering of answers (currently plain text); Codex `app-server` for token streaming.
- **Validation:** `npm run check` passes (typecheck, 15 unit tests, build). Live runs on the Git fixture:
  - Claude: answer from attachments, follow-up remembered context, MCP search allowed, edit/new file/commit blocked, cancel left no process.
  - Codex: answer, resumed session blocked edit/new file/commit.
  - In both cases git status and file hashes were unchanged.
  - Built extension with stubbed `vscode`: status, real Claude answer about an attached file, provider switch.
  - The owner confirmed it works in the Extension Development Host (F5).
