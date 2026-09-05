/**
 * YouTube Provider Types
 * Types for YouTube video upload and channel management
 */

export interface YouTubeUploadInput {
  /** Local file path or URL to the video */
  videoPath: string;
  /** Video title (max 100 characters) */
  title: string;
  /** Video description (max 5000 characters) */
  description: string;
  /** Tags for the video (max 500 characters total) */
  tags: string[];
  /** YouTube category ID (e.g., "22" for People & Blogs) */
  categoryId: string;
  /** Privacy status of the video */
  privacy: 'private' | 'unlisted' | 'public';
  /** Path to custom thumbnail image */
  thumbnailPath?: string;
  /** Playlist IDs to add the video to */
  playlistIds?: string[];
  /** Whether the video is made for kids */
  madeForKids: boolean;
  /** Default language of the video */
  defaultLanguage?: string;
}

export interface YouTubeUploadResult {
  /** YouTube video ID */
  videoId: string;
  /** URL to the video on YouTube */
  videoUrl: string;
  /** Current status of the video */
  status: 'uploaded' | 'processing' | 'published';
  /** URL to the video thumbnail */
  thumbnailUrl?: string;
}

export interface YouTubeChannel {
  /** Channel ID */
  id: string;
  /** Channel title/name */
  title: string;
  /** Channel thumbnail URL */
  thumbnailUrl: string;
  /** Number of subscribers; null when the API omitted it (hidden or absent). */
  subscriberCount: number | null;
}

export interface YouTubePlaylist {
  /** Playlist ID */
  id: string;
  /** Playlist title */
  title: string;
  /** Number of items in the playlist */
  itemCount: number;
}

export interface YouTubeCategory {
  /** Category ID */
  id: string;
  /** Category title */
  title: string;
}

export type YouTubeUploadProgress = (progress: number) => void;
