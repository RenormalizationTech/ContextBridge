# Marketplace Release

The publisher is **Renormalization Technology**, ID **`renormalizationtech`** (created and confirmed by the owner). `package.json` now uses this ID. The extension identity is `renormalizationtech.contextbridge-chat`.

The owner has verified installed 0.2.1. Version 0.3.0 was uploaded on October 14, 2026 as **ContextBridge Chat**, ID `contextbridge-chat`, because Marketplace rejected both the original package ID and display name as already taken. Marketplace validation succeeded and version 0.3.0 is publicly available. Installation from Marketplace remains to be checked.

## Publisher Setup

1. Sign in to the [Marketplace publisher management page](https://marketplace.visualstudio.com/manage) with the Microsoft account that should own the extension.
2. Choose an existing publisher or create one. Record its **ID**, which is distinct from its display name. Publisher IDs cannot be renamed after creation.
3. Set `package.json` → `publisher` to that exact ID before rebuilding the public VSIX.

The extension identity is `<publisher>.contextbridge-chat`. Changing the publisher changes the extension identity, so existing development installs do not become the new Marketplace extension automatically. Install the final package and check settings/history under that identity before publishing; keep the old install until any history you need is saved.

## Release Preparation

- Keep the version in `package.json` and the root entries of `package-lock.json` aligned. Update `CHANGELOG.md` for each release.
- Record a short demonstration: attach a file or selection, ask a question, show the answer, and click the uncommitted-change summary to review diffs.
- Use real editor screenshots for the listing. If adding a Marketplace icon, supply a PNG rather than the sidebar's SVG.
- Keep the README's prerequisites, local-only scope, Ask-mode guarantees and integration limitations accurate.

```sh
npm run test:boundary          # real providers; uses existing accounts
npm run package               # typecheck, tests, build, VSIX
npx --no-install vsce ls --tree
code --install-extension dist/contextbridge-0.3.0.vsix --force
```

Run **Developer: Reload Window** and verify current-file context, streaming, cancellation, history, approvals, and change review. Inspect the VSIX for the correct publisher, version, bundled code, README, changelog, license and assets. Keep provider credentials and personal source files out of listing assets.

## Final Validation (October 14, 2026)

The 0.3.0 VSIX was rebuilt and inspected with publisher `renormalizationtech`. Typecheck, all 65 tests and build passed. Live Ask checks passed for new and resumed conversations on Claude Code 2.1.296, Codex 0.162.1 (app-server and exec), and Copilot 1.0.98, with workspace files and `.git` unchanged. Marketplace validation succeeded for the public 0.3.0 upload. A real installed-extension screenshot is in `docs/images/ask-mode.png`; installation from Marketplace under the final identity remains to be checked.

## First Publication

For the first release, upload the inspected VSIX through the publisher management page using **New extension → Visual Studio Code**. This avoids setting up publishing credentials for a one-time upload. After publication, install from Marketplace in a fresh VS Code profile and verify the documented workflow.

For later automated releases, follow Microsoft's current authentication instructions instead of storing credentials in the repository.

Source: [Microsoft's publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension), checked October 14, 2026. The guide covers publisher registration, manual VSIX uploads, image restrictions and automated publishing.

## GitHub release

The `v0.3.0` GitHub release attaches the exact VSIX accepted by Marketplace: `contextbridge-chat-0.3.0.vsix`. README and screenshot improvements made afterward are repository documentation changes; they do not replace the already published package. Future Marketplace changes require a new version and upload.

## Logo update (0.3.1)

Version 0.3.1 adds `media/logo.png` as the package icon and includes the current README and screenshot. All 65 tests, typecheck, build and package checks passed. The update was accepted by Marketplace and entered verification on October 14, 2026.

## Scroll and draft fixes (0.3.2)

Version 0.3.2 keeps the reader's place while scrolled up during a streaming answer and keeps unsent question text when the view is hidden. The owner verified both in the Extension Development Host. `npm run package` passed typecheck, all 65 tests and the build. The packaged VSIX was checked for version 0.3.2, publisher `renormalizationtech` and both fixes in the bundled webview. The owner uploaded `dist/contextbridge-0.3.2.vsix` to Marketplace on October 19, 2026. The live provider boundary checks were not repeated because the change touches only the webview script.

## Toggle Chat (0.3.3)

Version 0.3.3 adds **ContextBridge: Toggle Chat**, a status bar item and `⌃⌥⌘B` (`Ctrl+Alt+Shift+B`), because VS Code's title-bar Toggle Chat button only toggles Copilot Chat. The owner verified the status bar item in the Extension Development Host. `npm run package` passed typecheck, all 65 tests and the build. The live provider boundary checks were not repeated because the change doesn't touch the provider adapters. The owner uploaded `dist/contextbridge-0.3.3.vsix` to Marketplace and published the `v0.3.3` GitHub release with the same VSIX on October 21, 2026.

## Copy selection (0.3.4)

Version 0.3.4 keeps focus in the conversation so Command+C / Ctrl+C copies selected answer text, and adds a keyboard focus outline. The owner confirmed copying works. Marketplace lists 0.3.4 as published on October 21, 2026. No `v0.3.4` Git tag or GitHub release was created.

## Distinct questions and long attachment names (0.3.5)

Version 0.3.5 shows the user's questions as right-aligned, accent-tinted bubbles, and shortens long attachment chip names (folders first, then the file name). Both are webview-only changes, and the owner confirmed both look right. `npm run package` passed typecheck, all 65 tests and the build. The live provider boundary checks were not repeated because the change doesn't touch the provider adapters. The owner uploaded `dist/contextbridge-0.3.5.vsix` to Marketplace on October 26, 2026, and the `v0.3.5` GitHub release attaches the same VSIX.

## Per-workspace picks and link fixes (0.3.6)

Version 0.3.6 stops the chat pickers from writing user settings. Provider, mode, model and effort choices are remembered per workspace, so using ContextBridge in one window no longer clears the chat or changes the mode in another; the settings become defaults for workspaces without a pick. It also stops web links from opening twice and adds **Copy Link Address** to links' right-click menu. The owner verified both in the Extension Development Host. `npm run package` passed typecheck, all 71 tests and the build. The live provider boundary checks were not repeated because the provider adapters are unchanged; Ask mode's enforcement is the same, and only where the selected mode is stored changed.
