import type { Attachment } from './types.ts';

// Attachments are the focus of the question, not a boundary: the provider may still read other files.
// Same format as the validated Phase 1 prototypes (prototypes/common.mjs).
export function buildPrompt(attachments: readonly Attachment[], question: string): string {
  const sections = attachments.map((attachment) => {
    const range = attachment.range ? ` lines ${attachment.range.start}-${attachment.range.end}` : '';
    return `<attachment path="${attachment.path}"${range}>\n${attachment.text}\n</attachment>`;
  });
  return [
    'The user attached the following context. Focus your answer on it.',
    'This is Ask mode: answer and suggest changes, but do not modify files.',
    '',
    ...sections,
    '',
    `Question: ${question}`,
  ].join('\n');
}
