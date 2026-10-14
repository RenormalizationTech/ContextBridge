# Marketplace Release

The owner has verified the installed 0.2.1 extension. Publisher identity and publication are pending. The current `package.json` publisher, `contextbridge-dev`, is the development identity; its Marketplace registration has not been verified.

## Publisher Setup

1. Sign in to the [Marketplace publisher management page](https://marketplace.visualstudio.com/manage) with the Microsoft account that should own the extension.
2. Choose an existing publisher or create one. Record its **ID**, which is distinct from its display name. Publisher IDs cannot be renamed after creation.
3. Set `package.json` → `publisher` to that exact ID before rebuilding the public VSIX.

The extension identity is `<publisher>.contextbridge`. Changing the publisher changes the extension identity, so existing development installs do not become the new Marketplace extension automatically. Install the final package and check settings/history under that identity before publishing; keep the old install until any history you need is saved.

## Release Preparation

- Keep the version in `package.json` and the root entries of `package-lock.json` aligned. Update `CHANGELOG.md` for each release.
- Record a short demonstration: attach a file or selection, ask a question, show the answer, and click the uncommitted-change summary to review diffs.
- Use real editor screenshots for the listing. If adding a Marketplace icon, supply a PNG rather than the sidebar's SVG.
- Keep the README's prerequisites, local-only scope, Ask-mode guarantees and integration limitations accurate.

```sh
npm run test:boundary          # real providers; uses existing accounts
npm run package               # typecheck, tests, build, VSIX
npx --no-install vsce ls --tree
code --install-extension dist/contextbridge-0.2.1.vsix --force
```

Run **Developer: Reload Window** and verify current-file context, streaming, cancellation, history, approvals, and change review. Inspect the VSIX for the correct publisher, version, bundled code, README, changelog, license and assets. Keep provider credentials and personal source files out of listing assets.

## First Publication

For the first release, upload the inspected VSIX through the publisher management page using **New extension → Visual Studio Code**. This avoids setting up publishing credentials for a one-time upload. After publication, install from Marketplace in a fresh VS Code profile and verify the documented workflow.

For later automated releases, follow Microsoft's current authentication instructions instead of storing credentials in the repository.

Source: [Microsoft's publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension), checked October 14, 2026. The guide covers publisher registration, manual VSIX uploads, image restrictions and automated publishing.
