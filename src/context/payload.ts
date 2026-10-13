import type { Mode } from '../providers/types.ts';
import type { ResolvedAttachment } from './types.ts';

export const MAX_ATTACHMENT_BYTES = 256 * 1024;
export const MAX_TOTAL_BYTES = 1024 * 1024;

// Files are binary if they contain a NUL byte near the start (the heuristic Git uses).
export function isBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, 8000).includes(0);
}

// Replaces content over the per-attachment or total size limit with a visible omission.
export function applyLimits(attachments: readonly ResolvedAttachment[]): ResolvedAttachment[] {
  const encoder = new TextEncoder();
  let total = 0;
  return attachments.map((attachment) => {
    if (attachment.text === undefined) return attachment;
    const bytes = encoder.encode(attachment.text).length;
    if (bytes > MAX_ATTACHMENT_BYTES) {
      return { path: attachment.path, range: attachment.range, omitted: 'too large to include' };
    }
    if (total + bytes > MAX_TOTAL_BYTES) {
      return { path: attachment.path, range: attachment.range, omitted: 'over the total attachment size limit' };
    }
    total += bytes;
    return attachment;
  });
}

// Attachments are the focus of the question, not a boundary: the provider may still read other files.
// Same format as the validated Phase 1 prototypes (prototypes/common.mjs).
export function buildPrompt(attachments: readonly ResolvedAttachment[], question: string, mode: Mode = 'ask'): string {
  const sections = attachments.map((attachment) => {
    const range = attachment.range ? ` lines ${attachment.range.start}-${attachment.range.end}` : '';
    if (attachment.omitted !== undefined) {
      return `<attachment path="${attachment.path}"${range} omitted="${attachment.omitted}" />`;
    }
    return `<attachment path="${attachment.path}"${range}>\n${attachment.text}\n</attachment>`;
  });
  const preface = ['The user attached the following context. Focus your answer on it.'];
  if (attachments.some((attachment) => attachment.omitted !== undefined)) {
    preface.push('Content marked omitted was not included; read those files yourself if needed.');
  }
  if (mode === 'ask') preface.push('This is Ask mode: answer and suggest changes, but do not modify files.');
  return [
    ...preface,
    '',
    ...sections,
    '',
    `Question: ${question}`,
  ].join('\n');
}
