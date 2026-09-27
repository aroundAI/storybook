'use client';

import { ChevronRight, Film, Plus, Upload } from 'lucide-react';

import type { SupportedLanguage } from '@kit/publishing/lib/constants';
import { Avatar, AvatarFallback, AvatarImage } from '@kit/ui/avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';

import { PLATFORM_CONFIG, type PlatformConnection } from './publish-types';
import { VideoCard } from './video-card';

interface FullVideosSectionProps {
  uploadedFullLanguages: SupportedLanguage[];
  localizedVideos: Record<string, string>;
  channelsByLanguage: Record<string, PlatformConnection[]>;
  fullVideoChannels: PlatformConnection[];
  isPending: boolean;
  uploadingThumbnails: Record<string, boolean>;
  getThumbnailForLanguage: (lang: string) => string | null;
  getAvailableLanguages: () => SupportedLanguage[];
  onOpenUploadDialog: (type: 'full') => void;
  onRemoveVideo: (lang: SupportedLanguage) => void;
  onThumbnailUpload: (lang: string, file: File) => void;
}

export function FullVideosSection({
  uploadedFullLanguages,
  localizedVideos,
  channelsByLanguage,
  fullVideoChannels,
  isPending,
  uploadingThumbnails,
  getThumbnailForLanguage,
  getAvailableLanguages,
  onOpenUploadDialog,
  onRemoveVideo,
  onThumbnailUpload,
}: FullVideosSectionProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Film className="h-5 w-5 text-indigo-500" />
            Full Videos
          </CardTitle>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <ChevronRight className="h-4 w-4" />
            {fullVideoChannels.length > 0 ? (
              <div className="flex -space-x-1">
                {fullVideoChannels.slice(0, 3).map((c) => (
                  <Avatar
                    key={c.id}
                    className="h-5 w-5 border-2 border-white dark:border-gray-800"
                  >
                    <AvatarImage src={c.avatarUrl ?? undefined} />
                    <AvatarFallback
                      className={`${PLATFORM_CONFIG[c.platform]?.bgColor} text-[8px] text-white`}
                    >
                      {PLATFORM_CONFIG[c.platform]?.shortName}
                    </AvatarFallback>
                  </Avatar>
                ))}
                {fullVideoChannels.length > 3 && (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-200 text-[9px] font-medium dark:bg-gray-700">
                    +{fullVideoChannels.length - 3}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-amber-600">No channels</span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {uploadedFullLanguages.length === 0 ? (
          <button
            onClick={() => onOpenUploadDialog('full')}
            data-test="upload-full-video"
            className="flex w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 p-8 text-gray-500 transition-colors hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-600 dark:border-gray-600 dark:bg-gray-800/50"
          >
            <Upload className="h-8 w-8" />
            <span className="font-medium">Upload Full Video (16:9)</span>
          </button>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {uploadedFullLanguages.map((lang) => (
              <VideoCard
                key={lang}
                type="full"
                lang={lang}
                videoUrl={localizedVideos[lang] ?? ''}
                channels={channelsByLanguage[lang] ?? []}
                isPending={isPending}
                thumbnailUrl={getThumbnailForLanguage(lang)}
                uploadingThumbnail={!!uploadingThumbnails[lang]}
                onRemoveVideo={onRemoveVideo}
                onThumbnailUpload={onThumbnailUpload}
              />
            ))}
            {getAvailableLanguages().length > 0 && (
              <button
                onClick={() => onOpenUploadDialog('full')}
                className="flex aspect-video w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 text-gray-500 transition-colors hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-600 dark:border-gray-600 dark:bg-gray-800/50 dark:hover:border-indigo-500 dark:hover:bg-gray-700/50 dark:hover:text-indigo-400"
              >
                <Plus className="h-6 w-6" />
                <span className="text-sm font-medium">Add Language</span>
              </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
