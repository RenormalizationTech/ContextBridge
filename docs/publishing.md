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
