// Chat webview script, bundled to dist/webview.js. Answers are rendered as Markdown with raw
// HTML disabled (see markdown.ts); everything else is inserted as text.
import { renderMarkdown } from './markdown.ts';

(function () {
  const vscode = acquireVsCodeApi();
  const messages = document.getElementById('messages');
  const attachments = document.getElementById('attachments');
  const composer = document.getElementById('composer');
  const question = document.getElementById('question');
  const send = document.getElementById('send');
  const cancel = document.getElementById('cancel');
  const provider = document.getElementById('provider');
  const status = document.getElementById('status');
  const newChat = document.getElementById('new-chat');
  let answer = null;
  let answerText = '';
  let renderScheduled = false;
  let busy = false;

  // Re-render the streaming answer at most once per frame.
  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      if (!answer) return;
      answer.innerHTML = renderMarkdown(answerText);
      answer.scrollIntoView({ block: 'end' });
    });
  }

  function finishAnswer() {
    if (answer) answer.innerHTML = renderMarkdown(answerText);
    answer = null;
    answerText = '';
  }

  function setBusy(value) {
    busy = value;
    send.disabled = value;
    cancel.hidden = !value;
    provider.disabled = value;
  }

  function renderProviders(providers, selectedId) {
    if (provider.options.length !== providers.length) {
      provider.replaceChildren(...providers.map((item) => new Option(item.label, item.id)));
    }
    provider.value = selectedId;
  }

  function renderStatus(value) {
    status.textContent = value ? value.detail : 'Checking provider...';
    status.className = value && !value.ok ? 'error' : 'muted';
  }

  function addMessage(role, text) {
    const element = document.createElement('div');
    element.className = `message ${role}`;
    element.textContent = text;
    messages.appendChild(element);
    element.scrollIntoView({ block: 'end' });
    return element;
  }

  function renderAttachments(items) {
    attachments.replaceChildren();
    if (items.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'muted';
      empty.textContent = 'No attachments. Right-click a file or selection and choose "Add ... to ContextBridge".';
      attachments.appendChild(empty);
      return;
    }
    for (const item of items) {
      const chip = document.createElement('span');
      chip.className = item.note ? 'chip warning' : 'chip';

      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'chip-label';
      label.textContent = item.range ? `${item.path}:${item.range.start}-${item.range.end}` : item.path;
      label.title = [
        item.kind === 'selection'
          ? 'Selection: snapshot taken when attached'
          : 'File: current content is read when you send',
        item.note,
        'Click to open',
      ].filter(Boolean).join('\n');
      label.addEventListener('click', () => vscode.postMessage({ type: 'openAttachment', id: item.id }));

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'chip-remove';
      remove.textContent = '×';
      remove.title = 'Remove';
      remove.setAttribute('aria-label', `Remove ${label.textContent}`);
      remove.addEventListener('click', () => vscode.postMessage({ type: 'removeAttachment', id: item.id }));

      chip.append(label, remove);
      attachments.appendChild(chip);
    }
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'link';
    clear.textContent = 'Clear';
    clear.addEventListener('click', () => vscode.postMessage({ type: 'clearAttachments' }));
    attachments.appendChild(clear);
  }

  composer.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = question.value.trim();
    if (!text || send.disabled) return;
    vscode.postMessage({ type: 'ask', question: text });
    question.value = '';
  });

  question.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      composer.requestSubmit();
    }
  });

  cancel.addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
  messages.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    if (link) {
      event.preventDefault();
      vscode.postMessage({ type: 'openLink', href: link.getAttribute('href') });
      return;
    }
    const copy = event.target.closest('button.copy');
    if (copy) {
      const code = copy.parentElement.querySelector('pre')?.textContent ?? '';
      navigator.clipboard.writeText(code).then(() => {
        copy.textContent = 'Copied';
        setTimeout(() => (copy.textContent = 'Copy'), 1500);
      });
    }
  });
  newChat.addEventListener('click', () => vscode.postMessage({ type: 'newChat' }));
  provider.addEventListener('change', () => vscode.postMessage({ type: 'selectProvider', id: provider.value }));

  window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.type) {
      case 'state':
        renderProviders(message.providers, message.providerId);
        renderStatus(message.status);
        renderAttachments(message.attachments);
        break;
      case 'start': {
        const user = addMessage('user', message.question);
        if (message.attachments.length > 0) {
          const sent = document.createElement('div');
          sent.className = 'sent';
          sent.textContent = `Attached: ${message.attachments.join(', ')}`;
          user.appendChild(sent);
        }
        answer = addMessage('assistant markdown', '');
        answerText = '';
        setBusy(true);
        break;
      }
      case 'cleared':
        messages.replaceChildren();
        answer = null;
        answerText = '';
        setBusy(false);
        break;
      case 'text':
        if (answer) {
          answerText += message.text;
          scheduleRender();
        }
        break;
      case 'notice':
        addMessage('status', message.text);
        break;
      case 'tool':
        if (!busy) break;
        // Keep tool activity above the answer text that follows it.
        messages.insertBefore(addMessage('status', message.detail ? `${message.name} ${message.detail}` : message.name), answer);
        break;
      case 'done':
        if (!busy) break;
        finishAnswer();
        if (message.cancelled) addMessage('status', 'Cancelled.');
        setBusy(false);
        break;
      case 'error':
        if (answer && !answerText) answer.remove();
        else finishAnswer();
        answer = null;
        answerText = '';
        addMessage('error', message.message);
        setBusy(false);
        break;
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
