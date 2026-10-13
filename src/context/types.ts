// 1-based inclusive line range.
export interface LineRange {
  start: number;
  end: number;
}

// What the user attached. Files are read when a question is sent (current content, including
// unsaved edits); selections are snapshots taken when attached, since their lines can shift.
export type Attachment =
  | { id: string; kind: 'file'; uri: string; path: string; sizeBytes: number }
  | { id: string; kind: 'selection'; uri: string; path: string; range: LineRange; text: string };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type NewAttachment = DistributiveOmit<Attachment, 'id'>;

// An attachment's content as sent. `omitted` explains why the content was left out.
export interface ResolvedAttachment {
  path: string;
  range?: LineRange;
  text?: string;
  omitted?: string;
}
