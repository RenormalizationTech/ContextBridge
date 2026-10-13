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
  let answer = null;

  function setBusy(busy) {
    send.disabled = busy;
    cancel.hidden = !busy;
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
      empty.textContent = 'No attachments';
      attachments.appendChild(empty);
      return;
    }
    for (const item of items) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = item.range ? `${item.path}:${item.range.start}-${item.range.end}` : item.path;
      attachments.appendChild(chip);
    }
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

  window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.type) {
      case 'state':
        provider.textContent = message.provider;
        renderAttachments(message.attachments);
        break;
      case 'start':
        addMessage('user', message.question);
        answer = addMessage('assistant', '');
        setBusy(true);
        break;
      case 'text':
        if (answer) {
          answer.textContent += message.text;
          answer.scrollIntoView({ block: 'end' });
        }
        break;
      case 'tool':
        addMessage('status', `${message.name}: ${message.detail}`);
        break;
      case 'done':
        if (message.cancelled) addMessage('status', 'Cancelled.');
        answer = null;
        setBusy(false);
        break;
      case 'error':
        addMessage('error', message.message);
        answer = null;
        setBusy(false);
        break;
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
