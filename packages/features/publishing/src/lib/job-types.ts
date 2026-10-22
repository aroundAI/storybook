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
  /**
   * KB-214: upload now, private, and let YouTube make it public at
   * `publishAt` (the post's time). The row stays `scheduled`.
   */
  staged?: { publishAt: string; goLiveWhenReady?: boolean };
}

export interface DeleteJobMessage extends BaseJobMessage {
  type: 'delete';
  publishId: string;
  platform: Platform;
  platformContentId: string;
  platformAccountId?: string;
}

/**
 * KB-214: the scheduled job's request that the worker look after one
 * YouTube channel's staged uploads: HD gate, publish times, the ones gone
 * public and the ones to delete. A pointer: the worker reads the rows.
 */
export interface YouTubeStagedCheckMessage {
  type: 'youtube-staged-check';
  platform: 'youtube';
  platformConnectionId: string;
}

export type JobMessage =
  | PublishJobMessage
  | DeleteJobMessage
  | YouTubeStagedCheckMessage;
