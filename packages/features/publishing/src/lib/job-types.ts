export interface PublishJobMessage {
  publishId: string;
  userId: string;
  platform:
    | 'youtube'
    | 'tiktok'
    | 'instagram'
    | 'facebook'
    | 'twitter'
    | 'linkedin';
  platformConnectionId: string;
  episodeId: string;
  videoUrl: string;
  title: string;
  description: string;
  tags: string[];
  thumbnailUrl?: string;
  metadata: Record<string, unknown>;
}
