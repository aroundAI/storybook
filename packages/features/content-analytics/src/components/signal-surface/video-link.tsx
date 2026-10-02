'use client';

import { ExternalLink } from 'lucide-react';

import type { SurfaceVideo } from '../../lib/signal-surface';

export interface VideoLinkProps {
  videoId: string;
  videos: Readonly<Record<string, SurfaceVideo>>;
  /** Opens that video's own signal surface. */
  onSelectVideo: (videoId: string) => void;
}

/**
 * A video named on the surface, as a link to its own signals — a creator
 * learns from the comparables themselves, not from a count of them — and,
 * when the publish recorded one, to the video on its platform.
 */
export function VideoLink({ videoId, videos, onSelectVideo }: VideoLinkProps) {
  const video = videos[videoId];
  const title =
    video?.title?.trim() || `Untitled video (${videoId.slice(0, 8)})`;

  return (
    <span className="inline-flex items-center gap-1">
      <a
        href={`#signal-surface`}
        className="underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        data-test="comparable-link"
        data-video-id={videoId}
        onClick={(event) => {
          event.preventDefault();
          onSelectVideo(videoId);
        }}
      >
        {title}
      </a>
      {video?.url && (
        <a
          href={video.url}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground hover:text-foreground"
          aria-label={`Open ${title} on its platform`}
        >
          <ExternalLink aria-hidden className="size-3" />
        </a>
      )}
    </span>
  );
}
