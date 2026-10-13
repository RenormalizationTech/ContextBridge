import type { AttachmentSummary } from '../context/attachmentStore.ts';
import type { ProviderEvent, ProviderStatus } from '../providers/types.ts';

// Messages between the chat webview (media/main.js) and the extension host.
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'ask'; question: string }
  | { type: 'cancel' }
  | { type: 'newChat' }
  | { type: 'selectProvider'; id: string }
  | { type: 'openAttachment'; id: string }
  | { type: 'removeAttachment'; id: string }
  | { type: 'clearAttachments' };

export type HostMessage =
  | {
      type: 'state';
      providers: { id: string; label: string }[];
      providerId: string;
      // Undefined while the check is running.
      status?: ProviderStatus;
      attachments: AttachmentSummary[];
    }
  | { type: 'start'; question: string; attachments: string[] }
  | { type: 'notice'; text: string }
  | { type: 'cleared' }
  | ProviderEvent;
