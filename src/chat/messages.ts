import type { Attachment } from '../context/types.ts';
import type { ProviderEvent } from '../providers/types.ts';

// Messages between the chat webview (media/main.js) and the extension host.
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'ask'; question: string }
  | { type: 'cancel' };

export type HostMessage =
  | { type: 'state'; provider: string; attachments: Pick<Attachment, 'id' | 'path' | 'range'>[] }
  | { type: 'start'; question: string }
  | ProviderEvent;
