// A snapshot of attached content, captured when the user attaches it.
export interface Attachment {
  id: string;
  // Workspace-relative path shown to the user and the provider.
  path: string;
  text: string;
  // 1-based inclusive line range for selection attachments.
  range?: { start: number; end: number };
}
