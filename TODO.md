# ContextBridge Development TODO

This is the handoff checklist for continuing development on another machine. Product scope and principles are in [PROJECT_GOALS.md](PROJECT_GOALS.md).

## Current State

- [x] Choose ContextBridge as the project name.
- [x] Define the product direction: one VS Code extension, Claude Code and Codex adapters, explicit attachments, Ask mode.
- [x] Document MVP goals and milestones.
- [x] Implement the extension: Claude Code and Codex providers, attachments, Ask/Agent modes, history (0.1.0), model and effort pickers (0.2.0), uncommitted-change review (0.2.1), Copilot CLI (0.3.0).

**Next task:** Verify Marketplace installation of `renormalizationtech.contextbridge-chat` and complete the remaining installed-provider checks.

## Continue on Another Machine

```sh
git clone https://github.com/RenormalizationTech/ContextBridge.git
cd ContextBridge
git switch main   # or the current development branch, if one is in progress
```

For an existing checkout, inspect `git status` and save any local work before updating it with `git pull --ff-only` on the appropriate branch. Reuse an existing development branch when continuing unfinished work.

- [x] Read `README.md`, `PROJECT_GOALS.md`, and this file (a routine first step on any machine).
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
- [x] Add a mock provider for offline development/tests (now test-only; removed from the production picker in 0.3.0).
- [x] Define provider executable discovery for local VS Code (done in Phase 4: login-shell PATH plus common install locations, overridable with `contextBridge.claude.path` / `contextBridge.codex.path`).

**Done when:** A fresh checkout can install dependencies, build, and open ContextBridge in a VS Code Extension Development Host; offline mock responses remain covered by tests.

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
- [x] Verify setup from a fresh checkout on the second development machine; document any environment limitations. (October 13, 2026: a fresh clone on the owner's MacBook Air with Node 26.11.1 built after `npm install`. Findings documented in the README: `npm install` is required before F5 or a build, and newer npm's install-scripts warning for esbuild/vsce-sign is harmless.)
- [x] Document installation, reliance on the provider CLIs for authentication, usage, local-only support, and exact access behavior (ask-only enforced; attachments focus but do not isolate).
- [x] Package an installable VSIX for personal use (`npm run package` → `dist/contextbridge-<version>.vsix`).
- [x] Choose a publisher identity, capture a real screenshot, and publish ContextBridge Chat 0.3.0 to the VS Code Marketplace.
- [ ] Compare the workflow with the official provider extensions and collect early-user feedback.

**Done when:** The packaged extension can be installed and the main workflow completed using the documentation, with no unsupported security or authentication claims.

## Later Backlog

- [ ] Bulk open-tab attachments, explicit Git-diff attachments, and diagnostics.
- [ ] Context-size estimates and saved context sets.
- [x] Persistent chat history (shipped in 0.1.0).
- [ ] Multi-root workspaces.
- [ ] Symbols/references and additional provider adapters.
- [ ] Antigravity CLI (`agy`): **deferred** (owner decision, October 13, 2026). An Ask-only provider looked feasible with an installed read-only custom agent, but `agy` is changing too fast and has no approval protocol for Agent mode. The problems and the conditions for revisiting are in `docs/provider-feasibility.md` ("Antigravity CLI `agy`").

Agent mode was added after the MVP as an optional mode (see CLAUDE.md decision 9); Ask stays the default.

## Handoff Routine

At the end of each development session:

- Mark completed items only after their completion criteria have been verified.
- Update the next task and record blockers or decisions below.
- Record commands/checks actually run and their results; do not imply unperformed validation passed.
- Commit related changes and push the development branch so the next machine can retrieve them.

### Latest Handoff

- **Updated:** October 14, 2026 (`main`, version 0.3.1).
- **Implemented:** Claude Code, Codex and GitHub Copilot providers, Ask/Agent modes, attachments, automatic current-file context, history, model/effort pickers, read-only Git tools, and the uncommitted-change summary with multi-file diff review.
- **Owner verification:** The installed 0.2.1 summary/diff view works. Copilot integration and the three-provider picker in installed 0.3.0 are pending owner verification.
- **Validation:** `npm run package` passed: typecheck, all 65 tests, build and 0.3.0 VSIX. Copilot's new/resumed Ask boundary passed with unchanged files and `.git`. `npm run test:copilot` passed attachments, workspace reads, resumed context, Agent Deny/Allow with previews, Agent-to-Ask restrictions, and cancellation during activity. The isolated bundle ran under VS Code's Electron runtime with a real Copilot model catalog and answer; host checks verified no Mock choice, old Mock history rejection and managed approvals under Bypass. Headless Chrome passed 11 picker/effort/approval checks. Repeat all-provider live boundary checks for the final Marketplace package.
- **Resolved:** The missing current-file feature was an outdated VSIX, not a source bug. README explains rebuilding/reinstalling; 0.2.1 distinguishes the newer package.
- **Decisions:** Copilot integrated after its feasibility spike; Mock removed from the picker/settings and retained for tests. Local VS Code only; Ask is default; MCP tools and user plugins keep their own capabilities. Antigravity remains deferred.
- **Next action:** Verify installation from Marketplace under `renormalizationtech.contextbridge-chat`, then complete the remaining installed Copilot/provider checks; follow [docs/publishing.md](docs/publishing.md).
- **Cleanup (October 14, 2026):** Removed old 0.2.0/0.2.1 VSIXs from `dist/` (only 0.3.0 remains), pruned `node_modules`, refreshed README/TODO for the three-provider state. Re-run `npm install` if dependencies are needed again.
- **Release checks:** Rebuilt under the confirmed publisher; typecheck, 65 tests, build and all eight live boundary checks passed. Marketplace validation succeeded; installation from Marketplace under the final identity remains pending.
- **Publisher:** Renormalization Technology (`renormalizationtech`), created by the owner and set in `package.json`. The new identity uses separate extension storage from `contextbridge-dev.contextbridge`; old history is not migrated automatically.
- **History:** Detailed implementation and earlier validation notes are preserved in [docs/development-history.md](docs/development-history.md).

## Marketplace Release Checklist

- [x] Owner verifies the installed 0.2.1 extension.
- [ ] Owner verifies Copilot (Ask/Agent, history, models, cancellation) and no Mock choice in installed 0.3.0.
- [x] Update current project goals, README, changelog and release instructions.
- [x] Confirm the publisher ID and create/access that publisher in Marketplace: Renormalization Technology (`renormalizationtech`), confirmed by the owner October 14.
- [x] Set `package.json` publisher to `renormalizationtech` and rebuild the 0.3.0 VSIX.
- [x] Capture a real screenshot using installed 0.3.0: Codex Ask, automatic current-file context, completed answer and Git summary (`docs/images/ask-mode.png`).
- [x] Repeat `npm run test:boundary`: Claude Code 2.1.296, Codex 0.162.1 (app-server and exec), Copilot 1.0.98; all eight new/resumed checks passed October 14, with files and `.git` unchanged.
- [x] Package and inspect the final VSIX: `renormalizationtech.contextbridge-chat`, version 0.3.0; typecheck, 65 tests and build passed.
- [ ] Install and verify the final VSIX under the confirmed publisher identity.
- [x] Publish the final VSIX: Marketplace validation succeeded for 0.3.0.
- [ ] Verify installation from Marketplace.
- [ ] Compare the workflow with official extensions and collect early-user feedback.

## Marketplace upload (October 14, 2026)

- Uploaded 0.3.0 as **ContextBridge Chat** (`renormalizationtech.contextbridge-chat`); Marketplace validation succeeded and 0.3.0 is available for use.
- Changed the package ID after Marketplace rejected `contextbridge`; changed the display name after it rejected `ContextBridge`.
- Typecheck, 65 tests, build and VSIX packaging passed. Updated README installation and storage paths for the new identity.
- Next: verify installation under the new identity.

- **Release documentation:** Added the Marketplace identity and installation link, dated changelog, real Codex Ask screenshot, and current publication status. The exact published VSIX is preserved for the GitHub release; later README edits are repository-only until the next Marketplace version.

## Logo update (0.3.1)

- Generated the bridge/chat logo with the built-in image generation tool; saved the 256 × 256 Marketplace PNG to `media/logo.png` and recorded the prompt in `docs/logo-prompt.txt`.
- Added the package icon, updated the README branding, and bumped package/lockfile to 0.3.1.
- Marketplace upload and validation pending.
