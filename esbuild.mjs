// Bundles the extension host (dist/extension.cjs, CommonJS as VS Code loads it) and the chat webview script (dist/webview.js).
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const extension = {
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  sourcemap: true,
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

if (watch) {
  await Promise.all([extension, webview].map(async (options) => (await esbuild.context(options)).watch()));
} else {
  await Promise.all([extension, webview].map((options) => esbuild.build(options)));
}
