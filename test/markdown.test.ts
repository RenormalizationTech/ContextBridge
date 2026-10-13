import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderMarkdown } from '../src/webview/markdown.ts';

test('renders common Markdown', () => {
  const html = renderMarkdown('# Title\n\n- **bold** and `code`\n\n| a | b |\n|---|---|\n| 1 | 2 |');
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<li><strong>bold<\/strong> and <code>code<\/code><\/li>/);
  assert.match(html, /<table>/);
});

test('wraps code blocks with a copy button and keeps the language class', () => {
  const html = renderMarkdown('```python\nprint("<hi>")\n```');
  assert.match(html, /<div class="code-block"><button type="button" class="copy"/);
  assert.match(html, /<code class="language-python">/);
  assert.match(html, /&lt;hi&gt;/);
  assert.doesNotMatch(html, /<hi>/);
});

test('never renders raw HTML or script links', () => {
  const html = renderMarkdown('<script>alert(1)</script> <img src=x onerror=alert(1)>\n\n[x](javascript:alert(1)) [y](https://example.com)');
  assert.doesNotMatch(html, /<script|<img/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /<a href="https:\/\/example\.com" title="https:\/\/example\.com">y<\/a>/);
});

test('colors code blocks that name a known language, safely', () => {
  const html = renderMarkdown('```python\ndef f(x):\n    return "<b>" + x  # note\n```');
  assert.match(html, /<span class="hljs-keyword">def<\/span>/);
  assert.match(html, /<span class="hljs-comment"># note<\/span>/);
  assert.match(html, /&lt;b&gt;/);
  assert.doesNotMatch(html, /<b>/);
});

test('leaves unknown or unnamed languages as escaped plain code', () => {
  assert.doesNotMatch(renderMarkdown('```\nx = 1\n```'), /hljs-/);
  assert.match(renderMarkdown('```nosuchlang\n<i>x</i>\n```'), /&lt;i&gt;x&lt;\/i&gt;/);
});

test('typesets $…$, $$…$$, \\(…\\) and \\[…\\] math, but not prices or code', () => {
  const count = (html: string) => (html.match(/class="katex"/g) ?? []).length;
  assert.equal(count(renderMarkdown('Inline $E = mc^2$.')), 1);
  assert.match(renderMarkdown('$$\n\\frac{1}{3}\n$$'), /katex-display/);
  assert.equal(count(renderMarkdown('Paren \\( a^2 + b^2 = c^2 \\) style.')), 1);
  assert.match(renderMarkdown('Bracket:\n\\[\n\\sum_i i\n\\]\nafter'), /katex-display/);
  assert.equal(count(renderMarkdown('It costs $5 and $10.')), 0);
  const code = renderMarkdown('Code `\\(x\\)` and\n```tex\n\\[ y \\]\n```');
  assert.equal(count(code), 0);
  assert.match(code, /<code>\\\(x\\\)<\/code>/);
});

test('math cannot create links, and bad TeX shows an inline error', () => {
  const html = renderMarkdown('$\\href{javascript:alert(1)}{x}$ $\\url{https://x.com}$ $\\frac{1}{$');
  assert.doesNotMatch(html, /<a[\s>]|\shref=/);
  assert.match(html, /katex-error/);
});
