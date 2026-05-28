export interface BaseJobMessage {
  userId: string;
  platformConnectionId: string;
  episodeId: string;
}

export interface PublishJobMessage extends BaseJobMessage {
  type: 'publish';
  publishId: string;
  platform:
    | 'youtube'
    | 'tiktok'
    | 'instagram'
    | 'facebook'
    | 'twitter'
    | 'linkedin';
  videoUrl: string;
  title: string;
  description: string;
  tags: string[];
  thumbnailUrl?: string;
  metadata: Record<string, unknown>;
}

export interface DeleteJobMessage extends BaseJobMessage {
  type: 'delete';
  publishId: string;
  platform:
    | 'youtube'
    | 'tiktok'
    | 'instagram'
    | 'facebook'
    | 'twitter'
    | 'linkedin';
  platformContentId: string;
  platformAccountId?: string;
}

export interface SocialTextPostJobMessage {
  type: 'social_text_post';
  socialPostId: string;
  userId: string;
  platformConnectionId: string;
  platform: 'linkedin';
  text: string;
  visibility: 'PUBLIC' | 'CONNECTIONS';
  authorUrn: string;
}

export type JobMessage =
  | PublishJobMessage
  | DeleteJobMessage
  | SocialTextPostJobMessage;
