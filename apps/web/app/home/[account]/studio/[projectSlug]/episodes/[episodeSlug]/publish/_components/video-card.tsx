'use client';

import {
  Check,
  Film,
  Loader2,
  Upload,
} from 'lucide-react';

import type { SupportedLanguage } from '@kit/publishing/lib/constants';
import { LANG_INFO } from '@kit/publishing/lib/constants';
import { Button } from '@kit/ui/button';

import { ChannelBadge } from './platform-ui';
import type { PlatformConnection, VideoType } from './publish-types';

interface VideoCardProps {
  type: VideoType;
  lang: SupportedLanguage;
  videoUrl: string;
  channels: PlatformConnection[];
  isPending: boolean;
  thumbnailUrl: string | null;
  uploadingThumbnail: boolean;
  onRemoveVideo: (lang: SupportedLanguage) => void;
  onThumbnailUpload: (lang: string, file: File) => void;
}

// Video card with channel destinations and thumbnail upload
export const VideoCard = ({
  type,
  lang,
  videoUrl,
  channels,
  isPending,
  thumbnailUrl,
  uploadingThumbnail,
  onRemoveVideo,
  onThumbnailUpload,
}: VideoCardProps) => {
  const relevantChannels =
    type === 'full'
      ? channels.filter((c) => ['youtube', 'facebook'].includes(c.platform))
      : channels.filter((c) =>
          ['youtube', 'instagram', 'facebook', 'tiktok'].includes(c.platform),
        );

  const thumbnailInputId = `thumbnail-input-${type}-${lang}`;

  return (
    <div className="group relative overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="aspect-video w-full bg-black">
        <video
          src={videoUrl}
          controls
          className="h-full w-full object-contain"
        />
      </div>
      <div className="p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">{LANG_INFO[lang]?.flag}</span>
            <span className="text-sm font-medium">
              {LANG_INFO[lang]?.name}
            </span>
            <Check className="h-4 w-4 text-green-500" />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onRemoveVideo(lang)}
            disabled={isPending}
            className="text-red-500 opacity-0 transition-opacity group-hover:opacity-100"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
          </Button>
        </div>

        {/* Thumbnail Preview and Upload */}
        <div className="mb-2 flex items-center gap-2">
          <input
            type="file"
            id={thumbnailInputId}
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onThumbnailUpload(lang, file);
            }}
          />
          <label
            htmlFor={thumbnailInputId}
            className="group/thumb relative h-10 w-16 flex-shrink-0 cursor-pointer overflow-hidden rounded border border-gray-200 hover:border-indigo-400 dark:border-gray-600 dark:hover:border-indigo-500"
          >
            {/* Upload spinner overlay */}
            {uploadingThumbnail && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50">
                <Loader2 className="h-4 w-4 animate-spin text-white" />
              </div>
            )}

            {/* Hover overlay */}
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/0 transition-colors group-hover/thumb:bg-black/20">
              <Upload className="h-4 w-4 text-white opacity-0 transition-opacity group-hover/thumb:opacity-100" />
            </div>

            {thumbnailUrl ? (
              <img
                src={thumbnailUrl}
                alt={`${LANG_INFO[lang]?.name} thumbnail`}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gray-100 dark:bg-gray-700">
                <Film className="h-4 w-4 text-gray-400" />
              </div>
            )}
          </label>

          <label
            htmlFor={thumbnailInputId}
            className="flex cursor-pointer items-center gap-1 rounded bg-gray-100 px-2 py-1 text-xs text-gray-600 transition-colors hover:bg-indigo-100 hover:text-indigo-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-indigo-900 dark:hover:text-indigo-400"
          >
            <Upload className="h-3 w-3" />
            {thumbnailUrl ? 'Change' : 'Add'} Thumbnail
          </label>
        </div>

        {/* Destination channels */}
        {relevantChannels.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {relevantChannels.map((conn) => (
              <ChannelBadge key={conn.id} conn={conn} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            No channels connected for {LANG_INFO[lang].name}
          </p>
        )}
      </div>
    </div>
  );
};
