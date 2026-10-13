// Shared helpers for the Phase 1 provider prototypes.
import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

export function parseArgs(argv) {
  const separator = argv.indexOf('--');
  if (separator < 0) throw new Error('Usage: --cwd <dir> [--attach <file>[:start-end]]... -- <question>');
  const options = argv.slice(0, separator);
  const question = argv.slice(separator + 1).join(' ');
  let cwd = process.cwd();
  const attachments = [];
  for (let i = 0; i < options.length; i += 2) {
    if (options[i] === '--cwd') cwd = resolve(options[i + 1]);
    else if (options[i] === '--attach') attachments.push(options[i + 1]);
    else throw new Error(`Unknown option: ${options[i]}`);
  }
  return { cwd, attachments, question };
}

// Attachments are the focus of the question, not a boundary: the provider may still read other files.
export function buildPrompt(cwd, attachments, question) {
  const sections = attachments.map((spec) => {
    const match = spec.match(/^(.*?)(?::(\d+)-(\d+))?$/);
    const path = resolve(cwd, match[1]);
    let lines = readFileSync(path, 'utf8').split('\n');
    let range = '';
    if (match[2]) {
      lines = lines.slice(Number(match[2]) - 1, Number(match[3]));
      range = ` lines ${match[2]}-${match[3]}`;
    }
    return `<attachment path="${relative(cwd, path)}"${range}>\n${lines.join('\n')}\n</attachment>`;
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
