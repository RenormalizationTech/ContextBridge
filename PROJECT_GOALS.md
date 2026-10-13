# ContextBridge: Project Purpose and Goals

## Purpose

ContextBridge is a VS Code extension that brings the convenience of GitHub Copilot Ask mode to Claude Code and Codex. Users attach the files and code selections relevant to their question with a "+" workflow, choose a provider, and receive an answer inside the editor. The provider suggests; the user makes the changes by hand.

The motivation: the official Claude Code and Codex extensions and CLIs operate at whole-project scope and tend to change a lot of code even when the user only wants suggestions. ContextBridge offers targeted context and an ask-only experience on top of the user's existing Claude Code and Codex installations.

**Product direction:** One repository, one VS Code extension, multiple provider adapters. ContextBridge is a thin layer over the official CLIs. It reuses their authentication, subscriptions, and capabilities rather than replacing them.

**Working tagline:** Your code. Your context. Your AI.

## Core Product Principles

1. **Targeted context:** Users can see, inspect, and remove every attachment before sending a question. Attachments tell the model where to focus. They do not isolate it: the provider may still read other workspace files, as in Copilot Ask mode.
2. **Ask-only operation:** In Ask mode the provider answers and suggests but does not modify workspace files or perform Git mutations. The user applies changes by hand.
3. **Enforced ask-only boundary:** Instructions such as “do not edit files” are insufficient. Provider configuration (tool permissions, sandbox or permission modes) must prevent file modifications. Read-oriented capabilities such as reading and searching files remain available.
4. **Thin wrapper, full capability:** Apart from the ask-only restriction, keep what each provider CLI offers. Do not build a new agent runtime.
5. **Provider independence:** Context collection and the chat interface are shared. Claude Code and Codex integrations live behind separate adapters.
6. **Delegated accounts:** Authentication, subscriptions, and billing are handled entirely by the Claude Code and Codex CLIs.
7. **Small, useful first release:** Prioritize a reliable question-and-answer workflow before expanding into broader context management.

## Target Users and Main Workflow

The first user is the project owner, building a small personal tool. Publishing to the VS Code Marketplace for other developers who want the same Copilot-style workflow is a later goal.

The main workflow is:

1. Open ContextBridge in VS Code.
2. Choose Claude Code or Codex.
3. Attach files from the Explorer and/or highlighted code from the editor.
4. Review the attached context and enter a question.
5. Receive a streaming answer, with the ability to cancel the request.

Example: Attach a numerical computation file and a selection from a helper module, then ask why the calculation is unstable. ContextBridge sends the attachments as the focus of the question and displays the explanation without changing either file.

## Scope

- **Environment:** Local VS Code only. Remote SSH, containers, and remote extension hosts are out of scope.
- **Providers:** Both Claude Code and Codex are targeted. Start with whichever one is easier to integrate well. Shipping a single provider first is acceptable.

## MVP Goals

| Goal | Completion criteria |
| --- | --- |
| File attachments | Users can add Explorer files, inspect their contents, and remove them before sending. |
| Selection attachments | Users can attach highlighted code with its source path and line range. |
| Visible context | The chat shows exactly which attachments will be sent; changed files and attachment snapshots have defined, visible behavior. |
| Provider support | The question-and-context workflow works with at least one provider (Claude Code or Codex) through a supported integration interface, with the second to follow. |
| Streaming chat | Responses appear incrementally; cancellation and provider errors are handled clearly. |
| Enforced Ask mode | Verification demonstrates that the provider cannot modify workspace files or perform Git mutations in Ask mode. |
| Usable setup | Documentation explains prerequisites, installation, reliance on the provider CLIs for authentication, and the actual access behavior (attachments focus but do not isolate). |

The MVP is complete when the user can install the extension, attach several files and a selection, ask a supported provider a question, and receive an answer without any workspace files being modified.

## Implementation Direction

Use TypeScript and the VS Code extension APIs for context collection and the editor interface. Keep three responsibilities separate:

- **Context collection and assembly:** Capture attachments, preserve source metadata, and construct a predictable request payload.
- **Chat and UI:** Manage attachment review, messages, streaming, cancellation, and errors.
- **Provider adapters:** Manage request transport, response events, and the ask-only restriction for each backend, relying on the CLI's own authentication.

Use structured provider interfaces where available rather than scraping terminal UI output. The exact Claude Code and Codex transports remain implementation decisions until their current interfaces and permission controls are verified.

## Milestones

### 1. Validate the Integration and Ask-Only Boundary

- Verify supported programmatic interfaces, streaming, and cancellation for both providers, and confirm they work with the user's existing CLI login.
- Prototype sending a question plus attached context and receiving a streamed answer.
- Determine which permission settings or sandbox modes block file modifications while keeping read-oriented capabilities.
- Verify that attempted file writes and Git mutations are blocked, using tool and access events rather than refusal text alone.
- Record limitations, and pick the provider to implement first.

### 2. Build the End-to-End MVP

- Create the extension scaffold and chat interface.
- Implement file and selection attachments with review and removal.
- Connect the first provider adapter and add streaming, cancellation, and clear error handling.
- Validate the complete workflow, add the second provider, and document setup.

### 3. Release

- Package an installable VSIX for personal use.
- Later, prepare a Marketplace release: publisher identity, documentation, and a short demonstration.
- Compare the experience with the official provider extensions and gather feedback from early users.

## Deferred Features

After the MVP, consider open-tab attachments, Git diffs, diagnostics, symbols, context-size estimates, saved context sets, persistent chat history, multi-root workspaces, and additional providers.

Agent mode, automatic edits, a new coding-agent runtime, and a custom billing/authentication platform are outside the initial scope. Any later action-capable mode would require an explicit product decision and separate permission design.

## Open Questions

- Which supported interface best fits each provider, including streaming and cancellation?
- Which provider settings reliably block file modifications while keeping read and search capabilities?
- How should attachments be presented to the provider so it treats them as the primary focus?
- What attachment size limits and truncation behavior should users see?
- Should follow-up questions reuse prior messages and attachments, and how will that context remain visible?

## Basis and Current Status

This document reflects the owner's decisions as of October 12, 2026 (also recorded in [CLAUDE.md](CLAUDE.md)). The repository contains documentation only, with no extension implementation yet.

Provider capabilities and integration details have not been independently verified. They are research inputs for Milestone 1, not established guarantees.
