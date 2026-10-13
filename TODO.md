# ContextBridge Development TODO

This is the handoff checklist for continuing development on another machine. Product scope and principles are in [PROJECT_GOALS.md](PROJECT_GOALS.md).

## Current State

- [x] Choose ContextBridge as the project name.
- [x] Define the product direction: one VS Code extension, Claude Code and Codex adapters, explicit attachments, Ask mode.
- [x] Document MVP goals and milestones.
- [ ] Implement the extension. The Phase 2 scaffold exists (mock provider only).

**Next task:** Day-to-day use of 0.1.0; verify setup on the second machine. Later: Marketplace publication.

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

- [x] Add meaningful checks for attachment payload correctness, provider event handling, cancellation, and the ask-only restriction. (Unit tests, fake-CLI adapter tests in `test/fakeCli.test.ts`, and the live `npm run test:boundary`.)
- [x] Manually verify file attachment, selection attachment, preview, removal, streaming, and follow-up behavior in VS Code. (Owner F5 checks after Phases 3 and 4 and Markdown.)
- [x] Repeat ask-only boundary checks with the actual extension and each supported provider. (`npm run test:boundary` drives the shipped adapters against the real CLIs.)
- [ ] Verify setup from a fresh checkout on the second development machine; document any environment limitations.
- [x] Document installation, reliance on the provider CLIs for authentication, usage, local-only support, and exact access behavior (ask-only enforced; attachments focus but do not isolate).
- [x] Package an installable VSIX for personal use (`npm run package` → `dist/contextbridge-0.1.0.vsix`).
- [ ] Later: choose a publisher identity, create a short demonstration, and publish to the VS Code Marketplace.
- [ ] Compare the workflow with the official provider extensions and collect early-user feedback.

**Done when:** The packaged extension can be installed and the main workflow completed using the documentation, with no unsupported security or authentication claims.

## Later Backlog

- [ ] Open-tab attachments, Git diffs, and diagnostics.
- [ ] Context-size estimates and saved context sets.
- [ ] Persistent chat history and multi-root workspaces.
- [ ] Symbols/references and additional provider adapters.

Agent mode was added after the MVP as an optional mode (see CLAUDE.md decision 9); Ask stays the default.

## Handoff Routine

At the end of each development session:

- [ ] Mark completed items only after their completion criteria have been verified.
- [ ] Update the next task and record blockers or decisions below.
- [ ] Record commands/checks actually run and their results; do not imply unperformed validation passed.
- [ ] Commit related changes and push the development branch so the next machine can retrieve them.

### Latest Handoff

- **Updated:** October 12, 2026 (branch `release-prep`).
- **Implemented:**
  - Phase 5 release prep: version 0.1.0 (Apache-2.0), `npm run package` (vsce 4.0.0), user README, fake-CLI adapter tests, and `npm run test:boundary`. The owner installed the VSIX and confirmed it works.
  - After that, from owner requests:
    - The chat moved to the secondary (right) side bar (`viewsContainers.secondarySidebar`).
    - Optional Agent mode: an Ask/Agent dropdown backed by the `contextBridge.mode` setting, default `ask`. Claude Code gets full tools, with permission prompts shown as Allow/Deny cards in the chat. Codex gets the `workspace-write` sandbox. A warning banner shows in Agent mode, and switching modes keeps the conversation.
- **Polish (October 13, branch `polish`; the owner confirmed each item in VS Code):**
  - **+ button:** a picker of the active selection, open editors and workspace files (multi-select; skips `node_modules`, `.git`, build dirs).
  - **Always allow:** approval cards gain a third button, scoped to the current chat (all edits / one exact command / one tool). It's never persisted, every auto-approval is shown, and it resets on New chat or when switching chats.
  - **Syntax colors:** highlight.js 11.12 (common languages) in code blocks, with light and dark palettes keyed off VS Code's body theme class.
  - **Checks:** 35 tests; stubbed host runs of the picker and of Always allow (edit scope auto-approves a later write, a plain Allow still asks again, New chat resets); jsdom check of cards, the + button and colored spans.
- **Codex web search (owner request):**
  - `contextBridge.codex.webSearch` (`live` default / `cached` / `disabled`), passed as `config.web_search` on thread start/resume (and `-c web_search=` for exec).
  - Codex's built-in default already allowed search (config `web_search: null`), but the mode is now explicit.
  - Activity lines show the query, which is only known on `item/completed`.
  - Checks: live searches for both providers; `test:boundary -- codex` still passes.
- **Agent permission level (owner request, modeled on Copilot's picker):**
  - A Default Permissions / Bypass Approvals dropdown below the input in Agent mode, per chat, saved with history, with the new-chat default from `contextBridge.agent.defaultPermissions`.
  - Bypass auto-approves each request with a chat notice and shows a red banner. A confirmation appears the first time, with "Don't Ask Again" stored in globalState.
  - Checks: stubbed host run with a fake claude (cancel/enable dialog, 0 cards and 4 notices under Bypass, New chat resets, don't-ask-again, History restores the level); jsdom picker visibility.
- **Copy answer (owner request):** a copy icon in each answer's footer copies the raw Markdown. It's also on cancelled answers that have text and on chats restored from history; checked in jsdom.
- **Math (owner request):**
  - KaTeX 0.18.9 through `@vscode/markdown-it-katex`, with an npm override so the plugin uses 0.18.9: the fix for GHSA-238p-pmpm-9mq7, and over two weeks old.
  - `\(…\)` / `\[…\]` are rewritten to dollar delimiters outside code. `trust` is off, so there are no links from TeX.
  - Only the `.woff2` fonts ship, in `dist/katex/`, and the CSP adds `font-src` for the extension's own files.
  - Checks: 37 tests; jsdom render of streamed math through `dist/webview.js`; all 20 referenced fonts present.
  - Fix: subscripts, accents and `\phi` showed as gaps in VS Code, because the webview CSP blocked KaTeX's inline style attributes. `style-src` now allows `'unsafe-inline'`; scripts stay nonce-only. Reproduced and confirmed with headless-Chrome screenshots under the old and new CSP.
- **Next action:** Use it day to day; verify a fresh checkout on the second machine. Later: Marketplace publisher and release.
- **Decided:** Ask mode keeps all MCP tools (Claude) and user plugins/config (Codex), a documented accepted risk. Agent mode is opt-in (CLAUDE.md decision 9).
- **Open decisions:** Marketplace publisher identity.
- **Validation:**
  - `npm run check` passes: typecheck, 27 tests and build. The tests include Agent mode: full tool set, approvals passed to the user and answered, Deny, cancelling during a pending approval, and Codex workspace-write on first questions and on resume.
  - Live, on throwaway repos:
    - Claude Agent mode: an Edit request reached the approval callback. When denied the file was unchanged; when allowed it was edited.
    - Codex Agent mode: edited the workspace file, but writing to `~/` was blocked. Writing to the system temp dir is allowed by Codex's workspace-write default.
  - `npm run test:boundary` (Ask mode) passed for both providers earlier in this session.
  - Chat readability (owner request): labeled turns (**You** / provider name, plus an Agent badge), tool activity and approval cards grouped in the answer, and a live progress line (Thinking / current tool / Waiting for your approval / Writing, with elapsed seconds) that becomes Done / Cancelled / Stopped. Checked by replaying a conversation into the built `dist/webview.js` in jsdom.
  - Second round of owner requests:
    - No YOU header; questions sit in a shaded box.
    - An animated border sweeps around the input box while busy, and holds still with reduced motion.
    - Chats survive hiding the view: a host-side transcript is replayed into the webview, and a running answer is no longer cancelled when the view is hidden.
    - Chat history: one JSON file per chat in per-workspace extension storage. It keeps the newest `history.maxChats` (default 50; 0 turns it off). A History quick pick reopens or deletes chats, there's a Clear Chat History command, and follow-ups resume the stored CLI conversation id.
    - A missing Claude session gives a clear message, and the next question starts fresh.
  - Checks for this round:
    - 30 tests pass, including the conversation model and the history store.
    - jsdom replay of `dist/webview.js` covered restore, the busy class and the History button.
    - Stubbed-`vscode` host run covered hiding the view mid-answer, completing in the background and restoring, history save/list/reopen/delete, and `maxChats` 0.
    - A live missing-session check on Claude passed.
  - Provider check on first open (owner request): if the saved provider's CLI isn't installed, it switches once per session to an installed one (never Mock, never mid-chat) and says so. A logged-out but installed CLI is left selected. Simulated runs: only Codex → switched; neither → stayed; question already sent → stayed.
  - Codex over `codex app-server` (owner request; `contextBridge.codex.transport`, default `app-server`, fallback `exec`):
    - Streams answers.
    - Agent mode is now read-only + approval `on-request`, with Allow/Deny cards (owner decision).
    - Checks: fake app-server tests (settings, streaming, resume, approvals, interrupt); live boundary (Ask) passed in new and resumed conversations; live Agent deny/allow/follow-up; live cancel with no leftover processes.
  - The owner installed the VSIX and confirmed these changes (the right side bar, Agent mode, chat layout, history, provider check, Codex streaming) in VS Code.
