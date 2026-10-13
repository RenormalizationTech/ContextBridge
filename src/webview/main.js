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
  const historyButton = document.getElementById('history');
  const mode = document.getElementById('mode');
  const agentBanner = document.getElementById('agent-banner');
  const permissions = document.getElementById('permissions');
  const permissionCards = new Map();
  // The answer in progress: { activity, body, progress, label, text, startedAt, timer }.
  let turn = null;
  let renderScheduled = false;
  let busy = false;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function scrollToEnd() {
    messages.scrollTop = messages.scrollHeight;
  }

  function header(name, badge) {
    const row = element('div', 'turn-header');
    row.appendChild(element('span', 'turn-name', name));
    if (badge) row.appendChild(element('span', 'turn-badge', badge));
    return row;
  }

  function addUserTurn(text, sentAttachments) {
    const node = element('div', 'turn user');
    const body = element('div', 'turn-body', text);
    if (sentAttachments.length > 0) body.appendChild(element('div', 'sent', `Attached: ${sentAttachments.join(', ')}`));
    node.appendChild(body);
    messages.appendChild(node);
  }

  function startAssistantTurn(providerLabel, mode, startedAt) {
    const node = element('div', 'turn assistant');
    node.appendChild(header(providerLabel, mode === 'agent' ? 'Agent' : undefined));
    const activity = element('div', 'turn-activity');
    const body = element('div', 'turn-body markdown');
    const progress = element('div', 'progress');
    progress.append(element('span', 'spinner'), element('span', 'progress-text'));
    node.append(activity, body, progress);
    messages.appendChild(node);
    turn = { activity, body, progress, label: 'Thinking', text: '', startedAt, timer: undefined };
    turn.timer = setInterval(updateProgress, 1000);
    updateProgress();
    scrollToEnd();
  }

  function elapsed(until = Date.now()) {
    return Math.max(0, Math.round((until - turn.startedAt) / 1000));
  }

  function updateProgress() {
    if (!turn) return;
    turn.progress.querySelector('.progress-text').textContent = `${turn.label}… ${elapsed()}s`;
  }

  function setProgress(label) {
    if (!turn) return;
    turn.label = label.length > 80 ? `${label.slice(0, 79)}…` : label;
    updateProgress();
  }

  function addActivity(node) {
    if (turn) turn.activity.appendChild(node);
    else messages.appendChild(node);
    scrollToEnd();
  }

  // Re-render the streaming answer at most once per frame.
  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      if (!turn) return;
      turn.body.innerHTML = renderMarkdown(turn.text);
      scrollToEnd();
    });
  }

  // Copies the answer's raw Markdown, like Copilot's copy action.
  function copyAnswerButton(markdown) {
    const button = element('button', 'copy-answer');
    button.type = 'button';
    button.title = 'Copy answer as Markdown';
    button.setAttribute('aria-label', 'Copy answer as Markdown');
    button.appendChild(copyIcon());
    const label = element('span', 'copy-answer-label');
    button.appendChild(label);
    button.addEventListener('click', () => {
      navigator.clipboard.writeText(markdown).then(() => {
        label.textContent = 'Copied';
        setTimeout(() => (label.textContent = ''), 1500);
      });
    });
    return button;
  }

  function copyIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('aria-hidden', 'true');
    for (const [x, y] of [[5, 5], [2, 2]]) {
      const rect = document.createElementNS(ns, 'rect');
      for (const [name, value] of Object.entries({ x, y, width: 9, height: 9, rx: 1.5, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.3 })) {
        rect.setAttribute(name, String(value));
      }
      svg.appendChild(rect);
    }
    return svg;
  }

  // Replaces the progress line with how the answer ended.
  function finishTurn(outcome, errorMessage, at) {
    if (!turn) {
      if (errorMessage) messages.appendChild(element('div', 'message error', errorMessage));
      scrollToEnd();
      return;
    }
    clearInterval(turn.timer);
    if (turn.text) turn.body.innerHTML = renderMarkdown(turn.text);
    else turn.body.remove();
    const seconds = elapsed(at);
    const footer = element('div', `turn-footer ${outcome}`);
    footer.appendChild(element('span', undefined, outcome === 'done'
      ? `Done in ${seconds}s`
      : outcome === 'cancelled'
        ? `Cancelled after ${seconds}s`
        : `Stopped after ${seconds}s`));
    if (turn.text) footer.appendChild(copyAnswerButton(turn.text));
    if (errorMessage) turn.progress.before(element('div', 'message error', errorMessage));
    turn.progress.replaceWith(footer);
    turn = null;
    scrollToEnd();
  }

  function setBusy(value) {
    busy = value;
    composer.classList.toggle('busy', value);
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

  function renderMode(value, providerId, level) {
    mode.value = value;
    const agent = value === 'agent';
    const bypass = agent && level === 'bypass';
    agentBanner.hidden = !agent;
    agentBanner.classList.toggle('bypass', bypass);
    permissions.hidden = !agent;
    permissions.value = level;
    permissions.classList.toggle('bypass', bypass);
    const name = providerId === 'claude' ? 'Claude Code' : providerId === 'codex' ? 'Codex' : 'The provider';
    agentBanner.textContent = bypass
      ? `Bypass Approvals: ${name} edits files and runs commands without asking. Each action is listed in the chat.`
      : `Agent mode: ${name} can edit files and run commands after you approve them in the chat.`;
    question.placeholder = value === 'agent'
      ? 'Ask or tell the agent what to do (Enter to send, Shift+Enter for a new line)'
      : 'Ask about your code (Enter to send, Shift+Enter for a new line)';
  }

  function addPermissionCard(message) {
    const card = document.createElement('div');
    card.className = 'permission';
    const title = document.createElement('div');
    title.className = 'permission-title';
    title.textContent = `Allow ${message.tool}?`;
    card.appendChild(title);
    if (message.detail) {
      const detail = document.createElement('code');
      detail.className = 'permission-detail';
      detail.textContent = message.detail;
      card.appendChild(detail);
    }
    if (message.preview) {
      const preview = document.createElement('pre');
      preview.textContent = message.preview;
      card.appendChild(preview);
    }
    const actions = document.createElement('div');
    actions.className = 'actions';
    const choices = [{ label: 'Allow', allow: true }];
    if (message.always) choices.push({ label: 'Always allow', allow: true, always: true, title: message.always.label });
    choices.push({ label: 'Deny', allow: false });
    for (const choice of choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = choice.label;
      if (choice.title) button.title = choice.title;
      if (choice.label !== 'Allow') button.className = 'secondary';
      button.addEventListener('click', () => vscode.postMessage({ type: 'permissionResponse', id: message.id, allow: choice.allow, always: choice.always }));
      actions.appendChild(button);
    }
    if (message.always) {
      const scope = message.always.label.charAt(0).toLowerCase() + message.always.label.slice(1);
      card.appendChild(element('div', 'permission-scope', `"Always allow" will ${scope}.`));
    }
    card.appendChild(actions);
    addActivity(card);
    permissionCards.set(message.id, card);
    setProgress('Waiting for your approval');
  }

  function resolvePermissionCard(id, allow, always) {
    const card = permissionCards.get(id);
    if (!card) return;
    permissionCards.delete(id);
    card.classList.add('resolved');
    card.querySelector('.actions').replaceChildren(Object.assign(document.createElement('span'), {
      className: 'muted',
      textContent: always ? 'Always allowed for this chat' : allow ? 'Allowed' : 'Denied',
    }));
    setProgress('Thinking');
  }

  function renderStatus(value) {
    status.textContent = value ? value.detail : 'Checking provider...';
    status.className = value && !value.ok ? 'error' : 'muted';
  }

  function renderAttachments(items) {
    attachments.replaceChildren();
    if (items.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'muted';
      empty.textContent = 'Add files with +, or right-click a file or selection.';
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
  historyButton.addEventListener('click', () => vscode.postMessage({ type: 'showHistory' }));
  document.getElementById('add-files').addEventListener('click', () => vscode.postMessage({ type: 'pickFiles' }));
  provider.addEventListener('change', () => vscode.postMessage({ type: 'selectProvider', id: provider.value }));
  mode.addEventListener('change', () => vscode.postMessage({ type: 'selectMode', mode: mode.value }));
  permissions.addEventListener('change', () => vscode.postMessage({ type: 'selectPermissionLevel', level: permissions.value }));

  function clearConversation() {
    if (turn) clearInterval(turn.timer);
    turn = null;
    permissionCards.clear();
    messages.replaceChildren();
    setBusy(false);
  }

  window.addEventListener('message', (event) => handle(event.data));

  function handle(message) {
    switch (message.type) {
      case 'restore':
        clearConversation();
        for (const item of message.messages) handle(item);
        if (turn) scheduleRender();
        scrollToEnd();
        break;
      case 'state':
        renderProviders(message.providers, message.providerId);
        renderMode(message.mode, message.providerId, message.permissionLevel);
        renderStatus(message.status);
        renderAttachments(message.attachments);
        break;
      case 'start':
        addUserTurn(message.question, message.attachments);
        startAssistantTurn(message.provider, message.mode, message.at);
        setBusy(true);
        break;
      case 'permission':
        addPermissionCard(message);
        break;
      case 'permissionResolved':
        resolvePermissionCard(message.id, message.allow, message.always);
        break;
      case 'cleared':
        clearConversation();
        break;
      case 'text':
        if (!turn) break;
        turn.text += message.text;
        setProgress('Writing');
        scheduleRender();
        break;
      case 'notice':
        addActivity(element('div', 'activity-line', message.text));
        break;
      case 'tool': {
        if (!busy) break;
        const line = message.detail ? `${message.name} ${message.detail}` : message.name;
        addActivity(element('div', 'activity-line', line));
        setProgress(line);
        break;
      }
      case 'done':
        if (!busy) break;
        finishTurn(message.cancelled ? 'cancelled' : 'done', undefined, message.at);
        setBusy(false);
        break;
      case 'error':
        finishTurn('error', message.message, message.at);
        setBusy(false);
        break;
    }
  }

  vscode.postMessage({ type: 'ready' });
})();
