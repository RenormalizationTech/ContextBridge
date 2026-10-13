import type { AttachmentSummary } from '../context/attachmentStore.ts';
import type { ProviderEvent } from '../providers/types.ts';

// Messages between the chat webview (media/main.js) and the extension host.
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'ask'; question: string }
  | { type: 'cancel' }
  | { type: 'openAttachment'; id: string }
  | { type: 'removeAttachment'; id: string }
  | { type: 'clearAttachments' };

export type HostMessage =
  | { type: 'state'; provider: string; attachments: AttachmentSummary[] }
  | { type: 'start'; question: string }
  | { type: 'notice'; text: string }
  | ProviderEvent;
