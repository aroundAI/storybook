'use client';

import Link from 'next/link';

import { ChevronRight, Mic, Music, Pencil, Volume2 } from 'lucide-react';

import type { Episode } from '@kit/episodes/types';
import { cn } from '@kit/ui/utils';

const LANG_FLAGS: Record<string, { flag: string }> = {
  en: { flag: '🇺🇸' },
  hi: { flag: '🇮🇳' },
  es: { flag: '🇪🇸' },
  pt: { flag: '🇧🇷' },
  fr: { flag: '🇫🇷' },
  de: { flag: '🇩🇪' },
  ja: { flag: '🇯🇵' },
  ko: { flag: '🇰🇷' },
  zh: { flag: '🇨🇳' },
  ar: { flag: '🇸🇦' },
  bn: { flag: '🇧🇩' },
};

interface EpisodeListItemProps {
  episode: Episode;
  account: string;
  projectSlug: string;
  availableLanguages?: string[];
  audioStats?: {
    dialogueTotal: number;
    dialogueCompleted: number;
    musicTotal: number;
    musicCompleted: number;
    sfxTotal: number;
    sfxCompleted: number;
  };
  isFirst?: boolean;
  isLast?: boolean;
}

/**
 * Derive stage status from the episode.status field
 * Status progression: draft → story → storyboard → visual-studio → audio-studio → review → published
 * This avoids fetching large JSON blobs just for boolean presence checks
 */
function getStageStatus(episode: Episode) {
  const status = episode.status;

  // Status progression map
  const statusOrder = [
    'draft',
    'story',
    'storyboard',
    'visual-studio',
    'audio-studio',
    'review',
    'published',
  ];
  const currentIndex = statusOrder.indexOf(status);

  return {
    story:
      currentIndex >= 1
        ? 'complete'
        : currentIndex === 0
          ? 'in-progress'
          : 'pending',
    screenplay:
      currentIndex >= 2
        ? 'complete'
        : currentIndex === 1
          ? 'in-progress'
          : 'pending',
    visuals:
      currentIndex >= 3
        ? 'complete'
        : currentIndex === 2
          ? 'in-progress'
          : 'pending',
  } as const;
}

function getStatusLabel(
  stage: 'story' | 'screenplay' | 'visuals',
  status: 'complete' | 'in-progress' | 'pending',
) {
  const labels = {
    story: 'Story',
    screenplay: 'Screenplay',
    visuals: 'Visuals',
  };

  const statusLabels = {
    complete: 'Done',
    'in-progress': 'In Progress',
    pending: 'Pending',
  };

  return `${labels[stage]}: ${statusLabels[status]}`;
}

function getStatusDotColor(status: 'complete' | 'in-progress' | 'pending') {
  if (status === 'complete') return 'bg-green-400';
  if (status === 'in-progress') return 'bg-blue-400';
  return 'bg-slate-500';
}

export function EpisodeListItem({
  episode,
  account,
  projectSlug,
  availableLanguages,
  audioStats,
  isFirst: _isFirst = false,
  isLast: _isLast = false,
}: EpisodeListItemProps) {
  const href = `/home/${account}/studio/${projectSlug}/episodes/${episode.slug ?? episode.id}`;
  const stages = getStageStatus(episode);

  return (
    <div className="group flex items-start gap-4">
      {/* Number circle - floating with gradient */}
      <div className="relative z-10 mt-4 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500/20 to-purple-500/20 text-sm font-semibold text-slate-300 ring-1 ring-white/10">
        {String(episode.number).padStart(2, '0')}
      </div>

      {/* Episode card - glass panel */}
      <Link href={href} className="flex-1">
        <div className="cursor-pointer rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-white/[0.12] hover:bg-white/[0.05] hover:shadow-lg">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-white">
                {episode.title}
              </h3>
              <p className="mb-3 text-xs text-gray-400 dark:text-gray-500">
                Updated {new Date(episode.updatedAt).toLocaleDateString()}
              </p>

              {/* Status badges - cinema badges */}
              <div className="flex flex-wrap gap-2 text-[10px]">
                {(['story', 'screenplay', 'visuals'] as const).map((stage) => (
                  <span
                    key={stage}
                    className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-0.5 text-slate-400 backdrop-blur-sm"
                  >
                    <div
                      className={cn(
                        'h-1.5 w-1.5 rounded-full',
                        getStatusDotColor(stages[stage]),
                      )}
                    />
                    {getStatusLabel(stage, stages[stage])}
                  </span>
                ))}

                {/* Language flags */}
                {availableLanguages && availableLanguages.length > 0 && (
                  <>
                    <div className="h-4 w-px self-center bg-white/10" />
                    {availableLanguages.sort().map((lang) => {
                      const info = LANG_FLAGS[lang];
                      if (!info) return null;
                      return (
                        <span
                          key={lang}
                          className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-slate-500"
                        >
                          <span>{info.flag}</span>
                          <span className="uppercase">{lang}</span>
                        </span>
                      );
                    })}
                  </>
                )}
              </div>

                {/* Audio generation progress */}
                {audioStats && (audioStats.dialogueTotal > 0 || audioStats.musicTotal > 0 || audioStats.sfxTotal > 0) && (
                  <div className="mt-2 flex items-center gap-3 text-[10px]">
                    {audioStats.dialogueTotal > 0 && (
                      <span className={cn(
                        'flex items-center gap-1 tabular-nums',
                        audioStats.dialogueCompleted === audioStats.dialogueTotal
                          ? 'text-green-400'
                          : 'text-slate-500',
                      )}>
                        <Mic className="h-3 w-3" />
                        {audioStats.dialogueCompleted}/{audioStats.dialogueTotal}
                      </span>
                    )}
                    {audioStats.musicTotal > 0 && (
                      <span className={cn(
                        'flex items-center gap-1 tabular-nums',
                        audioStats.musicCompleted === audioStats.musicTotal
                          ? 'text-green-400'
                          : 'text-slate-500',
                      )}>
                        <Music className="h-3 w-3" />
                        {audioStats.musicCompleted}/{audioStats.musicTotal}
                      </span>
                    )}
                    {audioStats.sfxTotal > 0 && (
                      <span className={cn(
                        'flex items-center gap-1 tabular-nums',
                        audioStats.sfxCompleted === audioStats.sfxTotal
                          ? 'text-green-400'
                          : 'text-slate-500',
                      )}>
                        <Volume2 className="h-3 w-3" />
                        {audioStats.sfxCompleted}/{audioStats.sfxTotal}
                      </span>
                    )}
                  </div>
                )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
              <button className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300">
                <Pencil className="h-4 w-4" />
              </button>
              <button className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </Link>
    </div>
  );
}
