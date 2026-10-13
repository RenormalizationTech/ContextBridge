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
  assert.match(html, /<code class="language-python">print\(&quot;&lt;hi&gt;&quot;\)/);
});

test('never renders raw HTML or script links', () => {
  const html = renderMarkdown('<script>alert(1)</script> <img src=x onerror=alert(1)>\n\n[x](javascript:alert(1)) [y](https://example.com)');
  assert.doesNotMatch(html, /<script|<img/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /<a href="https:\/\/example\.com" title="https:\/\/example\.com">y<\/a>/);
});
