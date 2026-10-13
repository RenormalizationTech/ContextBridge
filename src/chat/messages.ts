import type { AttachmentSummary } from '../context/attachmentStore.ts';
import type { Mode, PermissionRequest, ProviderStatus } from '../providers/types.ts';

// Messages between the chat webview (media/main.js) and the extension host.
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'ask'; question: string }
  | { type: 'cancel' }
  | { type: 'newChat' }
  | { type: 'selectProvider'; id: string }
  | { type: 'selectMode'; mode: Mode }
  | { type: 'showHistory' }
  | { type: 'permissionResponse'; id: string; allow: boolean }
  | { type: 'openAttachment'; id: string }
  | { type: 'openLink'; href: string }
  | { type: 'removeAttachment'; id: string }
  | { type: 'clearAttachments' };

export type HostMessage =
  | {
      type: 'state';
      providers: { id: string; label: string }[];
      providerId: string;
      mode: Mode;
      // Undefined while the check is running.
      status?: ProviderStatus;
      attachments: AttachmentSummary[];
    }
  | { type: 'cleared' }
  // Replays a saved conversation, e.g. when the view is shown again or a chat is opened from history.
  | { type: 'restore'; messages: TranscriptMessage[] }
  | TranscriptMessage;

// Messages that make up a conversation's transcript. `at` is a timestamp (ms) for elapsed times.
export type TranscriptMessage =
  | { type: 'start'; question: string; attachments: string[]; provider: string; mode: Mode; at: number }
  | { type: 'notice'; text: string }
  | ({ type: 'permission'; id: string } & PermissionRequest)
  | { type: 'permissionResolved'; id: string; allow: boolean }
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; detail: string }
  | { type: 'done'; cancelled: boolean; at: number }
  | { type: 'error'; message: string; at: number };
