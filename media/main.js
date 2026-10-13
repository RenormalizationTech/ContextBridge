// Chat webview script. Provider output is inserted as text, never as HTML.
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
  let busy = false;

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
        answer = addMessage('assistant', '');
        setBusy(true);
        break;
      }
      case 'cleared':
        messages.replaceChildren();
        answer = null;
        setBusy(false);
        break;
      case 'text':
        if (answer) {
          answer.textContent += message.text;
          answer.scrollIntoView({ block: 'end' });
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
        if (message.cancelled) addMessage('status', 'Cancelled.');
        answer = null;
        setBusy(false);
        break;
      case 'error':
        if (answer && !answer.textContent) answer.remove();
        addMessage('error', message.message);
        answer = null;
        setBusy(false);
        break;
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
