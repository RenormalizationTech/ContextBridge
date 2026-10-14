// Bundles the extension host (dist/extension.cjs, CommonJS as VS Code loads it), the Git MCP server
// (dist/git-mcp.cjs) and the chat webview script (dist/webview.js).
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const extension = {
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  // Copilot uses stdio only; its optional in-process native transport isn't shipped.
  external: ['vscode', 'koffi'],
  sourcemap: true,
  logLevel: 'info',
};

// The read-only Git MCP server Claude Code starts in Ask mode (src/git/gitServer.ts).
const gitServer = {
  entryPoints: ['src/git/gitServer.ts'],
  outfile: 'dist/git-mcp.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  logLevel: 'info',
};

// The chat webview script, with markdown-it bundled in.
const webview = {
  entryPoints: ['src/webview/main.js'],
  outfile: 'dist/webview.js',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  minify: true,
  sourcemap: true,
  logLevel: 'info',
};

// KaTeX's stylesheet and fonts for math in answers. Only .woff2 fonts are copied: they're listed
// first in KaTeX's CSS, so the webview never requests the others.
mkdirSync('dist/katex/fonts', { recursive: true });
cpSync('node_modules/katex/dist/katex.min.css', 'dist/katex/katex.min.css');
for (const font of readdirSync('node_modules/katex/dist/fonts').filter((name) => name.endsWith('.woff2'))) {
  cpSync(`node_modules/katex/dist/fonts/${font}`, `dist/katex/fonts/${font}`);
}

if (watch) {
  await Promise.all([extension, gitServer, webview].map(async (options) => (await esbuild.context(options)).watch()));
} else {
  await Promise.all([extension, gitServer, webview].map((options) => esbuild.build(options)));
}
