'use client';

import { useState } from 'react';

import { Globe, Share2 } from 'lucide-react';

import { PublishHub } from '@kit/publishing/components';
import { Button } from '@kit/ui/button';

import { useEpisodeContext } from '../_components/episode-context-provider';

type SupportedLanguage = 'en' | 'hi' | 'es' | 'pt';

const LANG_INFO: Record<SupportedLanguage, { name: string; flag: string }> = {
  en: { name: 'English', flag: '🇺🇸' },
  hi: { name: 'Hindi', flag: '🇮🇳' },
  es: { name: 'Spanish', flag: '🇪🇸' },
  pt: { name: 'Portuguese', flag: '🇧🇷' },
};

export default function PublishPage() {
  const { episode, projectId, accountSlug, accountId } = useEpisodeContext();

  // Get available localized videos
  const localizedVideos = (episode.localizedVideos ?? {}) as Record<string, string>;
  const availableLanguages = Object.keys(localizedVideos) as SupportedLanguage[];

  // Include English from finalVideoUrl if not in localizedVideos
  if (episode.finalVideoUrl && !localizedVideos['en']) {
    localizedVideos['en'] = episode.finalVideoUrl;
    if (!availableLanguages.includes('en')) {
      availableLanguages.unshift('en');
    }
  }

  const [selectedLanguage, setSelectedLanguage] = useState<SupportedLanguage>(
    availableLanguages[0] ?? 'en'
  );

  const currentVideoUrl = localizedVideos[selectedLanguage] ?? episode.finalVideoUrl;
  const hasFinalVideo = currentVideoUrl !== null && currentVideoUrl !== undefined;

  if (!hasFinalVideo) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700">
            <Share2 className="h-8 w-8 text-gray-400" />
          </div>
          <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white">
            Publish Hub Locked
          </h2>
          <p className="max-w-md text-gray-500 dark:text-gray-400">
            Export your final video from the Editing Studio to unlock
            multi-platform publishing. Once your video is ready, you can publish
            it to YouTube, TikTok, Instagram, and more.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-6">
      {/* Language Selector (when multiple localized videos exist) */}
      {availableLanguages.length > 1 && (
        <div className="mb-6 flex items-center gap-3">
          <Globe className="h-5 w-5 text-gray-500" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Select video language:
          </span>
          <div className="flex gap-2">
            {availableLanguages.map((lang) => (
              <Button
                key={lang}
                variant={selectedLanguage === lang ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedLanguage(lang)}
                className="gap-1.5"
              >
                <span>{LANG_INFO[lang]?.flag ?? '🌐'}</span>
                {LANG_INFO[lang]?.name ?? lang}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Current Language Badge */}
      {availableLanguages.length > 1 && (
        <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-sm text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-300">
          <span>{LANG_INFO[selectedLanguage]?.flag}</span>
          Publishing {LANG_INFO[selectedLanguage]?.name ?? selectedLanguage} version
        </div>
      )}

      <PublishHub
        episodeId={episode.id}
        projectId={projectId}
        accountSlug={accountSlug}
        accountId={accountId}
        videoUrl={currentVideoUrl!}
        thumbnailUrl={episode.thumbnailUrl ?? undefined}
        defaultTitle={episode.title}
        defaultDescription={episode.description ?? ''}
        duration={episode.durationSeconds ?? 0}
      />
    </div>
  );
}
