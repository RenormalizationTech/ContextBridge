import MarkdownIt from 'markdown-it';

// Raw HTML in answers is shown as text, never rendered; markdown-it also rejects
// javascript:, vbscript:, file: and most data: links. The webview CSP is a second layer.
const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

const renderFence = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, index, options, env, self) =>
  `<div class="code-block"><button type="button" class="copy" title="Copy code">Copy</button>${renderFence(tokens, index, options, env, self)}</div>`;

md.renderer.rules.link_open = (tokens, index, options, _env, self) => {
  tokens[index].attrSet('title', tokens[index].attrGet('href') ?? '');
  return self.renderToken(tokens, index, options);
};

export function renderMarkdown(text: string): string {
  return md.render(text);
}
