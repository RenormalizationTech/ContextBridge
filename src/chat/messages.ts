import type { AttachmentSummary } from '../context/attachmentStore.ts';
import type { LineRange } from '../context/types.ts';
import type { Mode, ModelCatalog, PermissionLevel, PermissionRequest, ProviderStatus } from '../providers/types.ts';

// Messages between the chat webview (media/main.js) and the extension host.
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'ask'; question: string }
  | { type: 'cancel' }
  | { type: 'newChat' }
  | { type: 'selectProvider'; id: string }
  | { type: 'selectMode'; mode: Mode }
  | { type: 'selectPermissionLevel'; level: PermissionLevel }
  // '' is the CLI's default; OTHER_MODEL asks for a model name.
  | { type: 'selectModel'; model: string }
  | { type: 'selectEffort'; effort: string }
  | { type: 'showHistory' }
  | { type: 'permissionResponse'; id: string; allow: boolean; always?: boolean }
  | { type: 'openAttachment'; id: string }
  | { type: 'openLink'; href: string }
  | { type: 'removeAttachment'; id: string }
  | { type: 'clearAttachments' }
  // Turns the automatic current-file attachment off or back on for this chat.
  | { type: 'setCurrentFile'; enabled: boolean }
  | { type: 'pickFiles' };

export type HostMessage =
  | {
      type: 'state';
      providers: { id: string; label: string }[];
      providerId: string;
      mode: Mode;
      permissionLevel: PermissionLevel;
      // Undefined while loading, or when the provider has no model choice.
      models?: ModelCatalog;
      // The current chat's choices; undefined is the CLI's default.
      model?: string;
      effort?: string;
      // The effort the chosen model uses when none is chosen, when known.
      defaultEffort?: string;
      // Undefined while the check is running.
      status?: ProviderStatus;
      attachments: AttachmentSummary[];
      // The file open in the editor (or its selection), attached automatically unless turned off.
      // Undefined when there's none, or when that file is already attached by hand.
      currentFile?: CurrentFileState;
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
  | { type: 'permissionResolved'; id: string; allow: boolean; always?: boolean }
  | { type: 'text'; text: string }
  // requested: the effort was asked for, but the CLI didn't confirm it.
  | { type: 'model'; model: string; effort?: string; requested?: boolean }
  | { type: 'tool'; name: string; detail: string }
  | { type: 'done'; cancelled: boolean; at: number }
  | { type: 'error'; message: string; at: number };

export const OTHER_MODEL = '__other__';

export interface CurrentFileState {
  path: string;
  // Non-empty selections, sent instead of the whole file.
  selections: LineRange[];
  enabled: boolean;
  note?: string;
}
