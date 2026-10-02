import type { Platform } from './platforms';

export interface BaseJobMessage {
  userId: string;
  platformConnectionId: string;
  episodeId: string;
}

export interface PublishJobMessage extends BaseJobMessage {
  type: 'publish';
  publishId: string;
  platform: Platform;
  videoUrl: string;
  title: string;
  description: string;
  tags: string[];
  thumbnailUrl?: string;
  metadata: Record<string, unknown>;
  /**
   * The publish's AI declaration (FILM-1731), sent on the platform's own
   * AI-label field. Absent on a message queued before it existed: not
   * declared.
   */
  aiGenerated?: boolean;
}

export interface DeleteJobMessage extends BaseJobMessage {
  type: 'delete';
  publishId: string;
  platform: Platform;
  platformContentId: string;
  platformAccountId?: string;
}

export type JobMessage = PublishJobMessage | DeleteJobMessage;
