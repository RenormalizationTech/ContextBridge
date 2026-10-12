# ContextBridge Development TODO

This is the handoff checklist for continuing development on another machine. Product scope and principles are in [PROJECT_GOALS.md](PROJECT_GOALS.md).

## Current State

- [x] Choose ContextBridge as the project name.
- [x] Define the product direction: one VS Code extension, Claude Code and Codex adapters, explicit attachments, Ask mode.
- [x] Document MVP goals and milestones.
- [ ] Implement the extension. No application code, package manifest, build commands, or tests exist yet.

**Next task:** Validate the provider integration and access boundaries in Phase 1 before building the full UI.

## Continue on Another Machine

```sh
git clone https://github.com/RenormalizationTech/ContextBridge.git
cd ContextBridge
git switch -c codex/provider-feasibility
```

For an existing checkout, inspect `git status` and save any local work before updating it with `git pull --ff-only` on the appropriate branch. Reuse an existing development branch when continuing unfinished work.

- [ ] Read `README.md`, `PROJECT_GOALS.md`, and this file.
- [ ] Install Git and the development tools needed for the next task. For extension implementation, choose and document supported Node.js, package-manager, and VS Code versions.
- [ ] Install and authenticate the provider CLIs on the machine where they will run, using their supported account workflows.
- [ ] Record the operating system and exact CLI versions used for feasibility checks.
- [ ] Decide whether development uses VS Code locally, through Remote SSH, or in another remote environment. A headless machine can run prototype checks; editor UI validation needs a VS Code development host.
- [ ] Once the scaffold exists, document dependency installation, build, test, and extension-debug commands in the README.

“Continue on another machine” currently means continuing development from this Git repository. Production remote execution and remote provider hosting are not established product requirements.

## Phase 1 — Provider Feasibility and Access Boundaries

- [ ] Check current official documentation for Claude Code and Codex programmatic interfaces, authentication, streaming, cancellation, and permission controls.
- [ ] Create a small prototype for each provider that accepts a question and explicit context, then streams an answer.
- [ ] Verify that existing-account authentication works for each integration; document prerequisites and any subscription limitations.
- [ ] Identify implicit context sources: working-directory files, instruction files, prior sessions, configuration, external tools, and integrations.
- [ ] Design a provider execution environment that prevents unrelated workspace reads, workspace writes, and model-requested command execution.
- [ ] Verify the boundaries with an unattached file containing a unique marker, attempted file modifications, and attempted command execution. Inspect access/tool events where supported; refusal text alone is not proof.
- [ ] Check how provider settings and enabled integrations affect those boundaries.
- [ ] Save findings, tested versions, reproduction commands, and unresolved limitations in `docs/provider-feasibility.md`.

**Done when:** Both providers answer using supplied context, and there is evidence for the required access restrictions. If a requirement cannot be enforced, record the blocker and resolve the product or technical decision before claiming it is guaranteed.

## Phase 2 — Extension Scaffold

- [ ] Initialize a TypeScript VS Code extension with a package manifest, lockfile, build configuration, and extension-debug configuration.
- [ ] Create separate modules for context collection, chat state/UI, and provider adapters.
- [ ] Define shared request, attachment, streaming-event, error, and cancellation interfaces.
- [ ] Add a command to open ContextBridge and a minimal chat view.
- [ ] Add a mock provider so editor workflows can be developed without a live account.
- [ ] Define extension-host placement and provider executable discovery for the supported local/remote development setup.

**Done when:** A fresh checkout can install dependencies, build, and open ContextBridge in a VS Code Extension Development Host with a mock response.

## Phase 3 — Explicit Context

- [ ] Add “Add to Context” for Explorer files.
- [ ] Add the active editor selection with source path and line range.
- [ ] Display attachments with preview and removal controls.
- [ ] Define attachment snapshot behavior, including unsaved editor content and changes after attachment.
- [ ] Handle duplicate attachments, missing files, unsupported/binary content, and oversized inputs.
- [ ] Show context limits and require visible handling of omitted or truncated content.
- [ ] Assemble a predictable request payload with clear source boundaries.

**Done when:** The user can inspect exactly what will be sent, and the payload contains only the selected attachments plus clearly disclosed conversation context.

## Phase 4 — Provider Chat

- [ ] Implement the Claude Code adapter using the validated Phase 1 approach.
- [ ] Implement the Codex adapter using the validated Phase 1 approach.
- [ ] Add provider selection and prerequisite/authentication status.
- [ ] Render streaming answers and support cancellation and process cleanup.
- [ ] Handle missing executables, authentication failures, connection failures, and provider errors.
- [ ] Define follow-up history and provider-switching behavior; keep reused context visible.
- [ ] Apply the verified access restrictions to every request.
- [ ] Render provider output safely and keep credentials and attached source content out of routine logs.

**Done when:** Both providers support the same file/selection question workflow, including cancellation and clear failures, while preserving the advertised Ask-mode boundaries.

## Phase 5 — Verify and Release

- [ ] Add meaningful checks for attachment payload correctness, provider event handling, cancellation, and access restrictions.
- [ ] Manually verify file attachment, selection attachment, preview, removal, streaming, and follow-up behavior in VS Code.
- [ ] Repeat boundary checks with the actual extension and both providers.
- [ ] Verify setup from a fresh checkout on the second development machine; document any environment limitations.
- [ ] Document installation, authentication, usage, supported environments, and exact access guarantees/limitations.
- [ ] Package an installable VSIX and create a short demonstration.
- [ ] Choose a publisher identity and release process before Marketplace publication.
- [ ] Compare the workflow with existing alternatives and collect early-user feedback.

**Done when:** Another user can install the packaged extension and complete the main workflow using the documentation, with no unsupported security or authentication claims.

## Later Backlog

- [ ] Open-tab attachments, Git diffs, and diagnostics.
- [ ] Context-size estimates and saved context sets.
- [ ] Persistent chat history and multi-root workspaces.
- [ ] Symbols/references and additional provider adapters.

Agent mode, automatic edits, and model-requested command execution are outside the initial scope.

## Handoff Routine

At the end of each development session:

- [ ] Mark completed items only after their completion criteria have been verified.
- [ ] Update the next task and record blockers or decisions below.
- [ ] Record commands/checks actually run and their results; do not imply unperformed validation passed.
- [ ] Commit related changes and push the development branch so the next machine can retrieve them.

### Latest Handoff

- **Updated:** October 12, 2026.
- **Implemented:** Project documentation only.
- **Next action:** Phase 1 provider research and isolated request prototypes.
- **Open decisions:** Provider transport, enforceable access boundaries, supported runtime versions, and local/remote extension-host placement.
- **Validation:** No implementation checks exist yet.
