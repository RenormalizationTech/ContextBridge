# ContextBridge: Project Purpose and Goals

## Purpose

ContextBridge is a VS Code extension that brings the convenience of GitHub Copilot Ask mode to Claude Code and Codex. Users attach the files and code selections relevant to their question, choose a provider, and receive an answer inside the editor.

The motivation is to make existing Claude Code and Codex accounts easier to use for focused code questions, with clear control over context and an ask-only experience.

**Product direction:** One repository, one VS Code extension, multiple provider adapters.

**Working tagline:** Your code. Your context. Your AI.

## Core Product Principles

1. **Explicit context:** Users can see, inspect, and remove every attachment before sending a question. Unrelated workspace content must not be silently included or inspected.
2. **Ask-only operation:** The initial product answers questions without modifying workspace files, executing model-requested commands, or performing Git mutations.
3. **Enforced boundaries:** Instructions such as “do not edit files” are insufficient. Provider configuration and isolation must enforce the advertised access restrictions.
4. **Provider independence:** Context collection and the chat interface are shared; Claude Code and Codex integrations live behind separate adapters.
5. **Existing account workflows:** Prefer supported integration paths that reuse users' existing CLI authentication. Subscription eligibility and integration capabilities must be verified for each provider.
6. **Small, useful first release:** Prioritize a reliable question-and-answer workflow before expanding into broader context management.

Read-only access and attached-context-only access are separate requirements. A backend that cannot write files might still read unrelated files. Both boundaries need validation before the product claims to guarantee them. Launching a configured local provider process is necessary infrastructure; Ask mode must prevent the model from invoking shell commands or other execution tools.

## Target Users and Main Workflow

Initial users are developers and researchers who already use Claude Code or Codex and want to ask focused questions about code without giving an agent broad workspace access.

The main workflow is:

1. Open ContextBridge in VS Code.
2. Choose Claude Code or Codex.
3. Attach files from the Explorer and/or highlighted code from the editor.
4. Review the attached context and enter a question.
5. Receive a streaming answer, with the ability to cancel the request.

Example: Attach a numerical computation file and a selection from a helper module, then ask why the calculation is unstable. ContextBridge supplies the selected context and displays the explanation without changing either file.

## MVP Goals

| Goal | Completion criteria |
| --- | --- |
| File attachments | Users can add Explorer files, inspect their contents, and remove them before sending. |
| Selection attachments | Users can attach highlighted code with its source path and line range. |
| Visible context | The chat shows exactly which attachments will be sent; changed files and attachment snapshots have defined, visible behavior. |
| Two providers | The same question-and-context workflow works with both Claude Code and Codex through supported integration interfaces. |
| Streaming chat | Responses appear incrementally; cancellation and provider errors are handled clearly. |
| Enforced Ask mode | Verification demonstrates that providers cannot modify workspace files, execute model-requested commands, or inspect unrelated workspace content. |
| Usable setup | Documentation explains prerequisites, authentication, installation, and the actual context/access boundaries. |

The MVP is complete when a user can install the extension, attach several files and a selection, ask either provider a question, and receive an answer while the stated access boundaries hold.

## Implementation Direction

Use TypeScript and the VS Code extension APIs for context collection and the editor interface. Keep three responsibilities separate:

- **Context collection and assembly:** Capture attachments, preserve source metadata, and construct a predictable request payload.
- **Chat and UI:** Manage attachment review, messages, streaming, cancellation, and errors.
- **Provider adapters:** Manage supported authentication, request transport, response events, and access restrictions for each backend.

Use structured provider interfaces where available rather than scraping terminal UI output. The exact Claude Code and Codex transports remain implementation decisions until their current interfaces and restrictions are verified.

## Milestones

### 1. Validate the Integration and Access Boundaries

- Verify supported programmatic interfaces and existing-account authentication for both providers.
- Prototype sending only a supplied context payload and receiving an answer.
- Determine which tools, implicit context sources, working directories, and permission settings need to be disabled or isolated.
- Verify behavior against attempts to read an unattached file, write a file, and execute a command.
- Record any limitations. If either provider cannot meet the boundary, resolve that limitation before claiming the MVP satisfies it.

### 2. Build the End-to-End MVP

- Create the extension scaffold and chat interface.
- Implement file and selection attachments with review and removal.
- Connect the provider adapters and add streaming, cancellation, and clear error handling.
- Validate the complete workflow with both providers and document setup.

### 3. Release and Validate Demand

- Package an installable early release and provide a short demonstration.
- Compare the actual experience with official provider extensions and existing alternatives.
- Gather feedback from users who regularly ask questions about code.
- Prioritize evidence of repeat use, successful setup, trust in context control, and specific workflow requests over GitHub stars alone.

## Deferred Features

After the MVP, consider open-tab attachments, Git diffs, diagnostics, symbols, context-size estimates, saved context sets, persistent chat history, multi-root workspaces, and additional providers.

Agent mode, automatic edits, command execution, a new coding-agent runtime, and a custom billing/authentication platform are outside the initial scope. Any later action-capable mode would require an explicit product decision and separate permission design.

## Open Questions

- Which supported interface best fits each provider, including streaming and cancellation?
- Can both backends enforce attached-context-only access, including automatic instruction files, session history, external tools, and other implicit context?
- What attachment size limits and truncation behavior should users see?
- Should follow-up questions reuse prior messages and attachments, and how will that context remain visible?
- What specific friction remains in competing extensions that ContextBridge can demonstrably solve?

## Basis and Current Status

This document summarizes the supplied prior conversation and sets a proposed project roadmap. The project name is **ContextBridge**. At the time of writing, the repository contains an initial README and license, with no extension implementation yet.

Provider capabilities, subscription support, competitor features, and naming availability discussed in the prior conversation have not been independently verified here. They are research inputs, not established implementation guarantees or evidence of market demand.
