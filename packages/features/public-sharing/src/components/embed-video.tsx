'use client';

import { useMemo } from 'react';

interface EmbedVideoProps {
    youtubeUrl?: string | null;
    facebookUrl?: string | null;
    title: string;
    className?: string;
}

/**
 * Extract YouTube video ID from various URL formats:
 * - https://www.youtube.com/watch?v=VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://www.youtube.com/embed/VIDEO_ID
 * - https://www.youtube.com/shorts/VIDEO_ID
 */
function extractYouTubeVideoId(url: string): string | null {
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})/,
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match?.[1]) {
            return match[1];
        }
    }
    return null;
}

/**
 * Extract Facebook video ID from URL:
 * - https://www.facebook.com/watch/?v=VIDEO_ID
 * - https://www.facebook.com/USER/videos/VIDEO_ID
 * - https://fb.watch/VIDEO_ID
 */
function extractFacebookVideoUrl(url: string): string | null {
    // Facebook embeds use the full URL, not just an ID
    if (url.includes('facebook.com') || url.includes('fb.watch')) {
        return url;
    }
    return null;
}

/**
 * Embeds YouTube or Facebook video player.
 * Priority: YouTube > Facebook
 * Using embedded players boosts platform algorithms.
 */
export function EmbedVideo({
    youtubeUrl,
    facebookUrl,
    title,
    className = '',
}: EmbedVideoProps) {
    const embedSource = useMemo(() => {
        // Priority 1: YouTube
        if (youtubeUrl) {
            const videoId = extractYouTubeVideoId(youtubeUrl);
            if (videoId) {
                return {
                    type: 'youtube' as const,
                    embedUrl: `https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1`,
                    videoId,
                };
            }
        }

        // Priority 2: Facebook
        if (facebookUrl) {
            const fbUrl = extractFacebookVideoUrl(facebookUrl);
            if (fbUrl) {
                return {
                    type: 'facebook' as const,
                    embedUrl: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(fbUrl)}&show_text=false&width=560`,
                    videoUrl: fbUrl,
                };
            }
        }

        return null;
    }, [youtubeUrl, facebookUrl]);

    if (!embedSource) {
        return (
            <div className={`aspect-video bg-slate-800 rounded-xl flex items-center justify-center ${className}`}>
                <p className="text-slate-400">Video not available</p>
            </div>
        );
    }

    return (
        <div className={`aspect-video bg-black rounded-xl overflow-hidden ${className}`}>
            {embedSource.type === 'youtube' && (
                <iframe
                    src={embedSource.embedUrl}
                    title={title}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                    loading="lazy"
                />
            )}

            {embedSource.type === 'facebook' && (
                <iframe
                    src={embedSource.embedUrl}
                    title={title}
                    className="w-full h-full"
                    style={{ border: 'none', overflow: 'hidden' }}
                    allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
                    allowFullScreen
                    loading="lazy"
                />
            )}
        </div>
    );
}

/**
 * Platform badge to show where the video is from
 */
export function VideoPlatformBadge({ platform }: { platform: 'youtube' | 'facebook' }) {
    if (platform === 'youtube') {
        return (
            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-red-500/20 text-red-400 text-xs font-medium">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z" />
                </svg>
                YouTube
            </span>
        );
    }

    return (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-blue-500/20 text-blue-400 text-xs font-medium">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
            </svg>
            Facebook
        </span>
    );
}
