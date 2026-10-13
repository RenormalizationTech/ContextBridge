import markdownItKatex from '@vscode/markdown-it-katex';
import hljs from 'highlight.js/lib/common';
import MarkdownIt from 'markdown-it';

// Raw HTML in answers is shown as text, never rendered; markdown-it also rejects
// javascript:, vbscript:, file: and most data: links. The webview CSP is a second layer.
// Code blocks that name a known language are colored by highlight.js, which escapes the code.
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  highlight: (code, language) => {
    const name = language.toLowerCase();
    if (!name || !hljs.getLanguage(name)) return '';
    try {
      return hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
    } catch {
      return '';
    }
  },
});

// Math: $…$ / $$…$$ (and ```math blocks) are typeset by KaTeX. KaTeX's `trust` stays off, so
// commands like \href and \url can't add links or HTML; bad input renders as an inline error.
// The plugin is CommonJS with only `exports.default`; bundlers unwrap it, Node's ESM loader doesn't.
const katexPlugin = (markdownItKatex as unknown as { default?: typeof markdownItKatex }).default ?? markdownItKatex;
md.use(katexPlugin, { throwOnError: false, enableFencedBlocks: true });

const renderFence = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, index, options, env, self) =>
  `<div class="code-block"><button type="button" class="copy" title="Copy code">Copy</button>${renderFence(tokens, index, options, env, self)}</div>`;

md.renderer.rules.link_open = (tokens, index, options, _env, self) => {
  tokens[index].attrSet('title', tokens[index].attrGet('href') ?? '');
  return self.renderToken(tokens, index, options);
};

export function renderMarkdown(text: string): string {
  return md.render(normalizeMath(text));
}

// Models often write \(…\) and \[…\], which Markdown would turn into plain parentheses and
// brackets. Rewrite them as $…$ and $$…$$, leaving fenced code and inline code untouched.
export function normalizeMath(text: string): string {
  return text
    .split(/(^(?:```|~~~)[^\n]*\n[\s\S]*?(?:^(?:```|~~~)[ \t]*$|(?![\s\S])))/m)
    .map((part, index) => (index % 2 === 1 ? part : part.split(/(`+[^`]*`+)/).map((piece, i) => (i % 2 === 1 ? piece : rewrite(piece))).join('')))
    .join('');
}

function rewrite(prose: string): string {
  return prose
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, math: string) => `\n$$\n${math.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, math: string) => `$${math.trim()}$`);
}
