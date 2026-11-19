import type { Mode } from '../providers/types.ts';
import type { TranscriptMessage } from './messages.ts';

const MAX_RECAP = 8_000;
const MAX_TURN = 3_900;

function excerpt(mode: Mode, question: string, answer: string): string {
  const serialize = () => JSON.stringify({ mode, question, answer }).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');
  let result = serialize();
  while (result.length > MAX_TURN) {
    if (question.length > answer.length) question = question.slice(0, question.length / 2) + '…';
    else answer = answer.slice(0, answer.length / 2) + '…';
    result = serialize();
  }
  return result;
}

// Transcript excerpts cover completed turns only. Tool actions, approval decisions, and
// attachments stay out of the recap. The receiving session treats the excerpts as history.
export function modeRecap(messages: readonly TranscriptMessage[], mode: Mode, resumed: boolean): string {
  const turns: string[] = [];
  let current: Extract<TranscriptMessage, { type: 'start' }> | undefined;
  let answer = '';
  for (const message of messages) {
    switch (message.type) {
      case 'start':
        current = message;
        answer = '';
        break;
      case 'text':
        if (current) answer = (answer + message.text.slice(0, 2400)).slice(0, 2400);
        break;
      case 'done':
        if (current && !message.cancelled) {
          if (resumed && current.mode === mode) turns.length = 0;
          else turns.push(excerpt(current.mode, current.question.slice(0, 1200), answer));
        }
        current = undefined;
        break;
      case 'error':
        current = undefined;
        break;
    }
  }
  const recent: string[] = [];
  let size = 0;
  for (let index = turns.length - 1; index >= 0; index--) {
    size += turns[index].length + 1;
    if (size > MAX_RECAP) break;
    recent.unshift(turns[index]);
  }
  return recent.join('\n');
}
