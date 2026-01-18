'use client';

import { useMemo } from 'react';

interface VideoSource {
  youtube?: {
    video_id: string;
    url: string;
    channel_id: string;
  };
  facebook?: {
    video_id: string;
    url: string;
    page_id: string;
  };
}

interface VideoPlayerProps {
  videoSource: VideoSource | null;
  title: string;
  className?: string;
}

/**
 * VideoPlayer component that embeds YouTube or Facebook videos.
 * Priority: YouTube > Facebook
 */
export function VideoPlayer({
  videoSource,
  title,
  className = '',
}: VideoPlayerProps) {
  const embedUrl = useMemo(() => {
    if (!videoSource) return null;

    // Prefer YouTube
    if (videoSource.youtube?.video_id) {
      return `https://www.youtube.com/embed/${videoSource.youtube.video_id}?rel=0&modestbranding=1`;
    }

    // Fallback to Facebook
    if (videoSource.facebook?.video_id) {
      const fbUrl = encodeURIComponent(videoSource.facebook.url);
      return `https://www.facebook.com/plugins/video.php?href=${fbUrl}&show_text=false&width=1280`;
    }

    return null;
  }, [videoSource]);

  if (!embedUrl) {
    return (
      <div
        className={`flex aspect-video items-center justify-center rounded-lg bg-gray-900 ${className}`}
      >
        <div className="text-center text-gray-400">
          <svg
            className="mx-auto mb-4 h-16 w-16 opacity-50"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
          <p className="text-sm">Video not available</p>
        </div>
      </div>
    );
  }

  const isYouTube = videoSource?.youtube?.video_id;

  return (
    <div
      className={`aspect-video overflow-hidden rounded-lg bg-black ${className}`}
    >
      <iframe
        src={embedUrl}
        title={title}
        className="h-full w-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        loading="lazy"
        referrerPolicy={
          isYouTube ? 'strict-origin-when-cross-origin' : undefined
        }
      />
    </div>
  );
}

/**
 * Get the best video source for a given language from localized videos.
 */
export function getVideoForLanguage(
  localizedVideos: Record<string, VideoSource> | null,
  language: string,
): VideoSource | null {
  if (!localizedVideos) return null;

  // Try exact language match
  if (localizedVideos[language]) {
    return localizedVideos[language];
  }

  // Fallback to English
  if (localizedVideos['en']) {
    return localizedVideos['en'];
  }

  // Fallback to first available
  const firstKey = Object.keys(localizedVideos)[0];
  return firstKey ? (localizedVideos[firstKey] ?? null) : null;
}
