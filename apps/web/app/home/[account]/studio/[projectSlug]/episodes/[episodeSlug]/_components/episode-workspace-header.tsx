'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { format } from 'date-fns';
import { ArrowLeft, MapPin, MoreVertical, Sparkles, User } from 'lucide-react';

import { CanonHealthBadge } from './canon-health-badge';
import { useEpisodeContext } from './episode-context-provider';
import { StudioSwitcher } from './studio-switcher';

export function EpisodeWorkspaceHeader() {
  const pathname = usePathname() ?? '';
  const isEditingStudio = pathname.includes('/editing-studio');
  const { episode, projectSlug, accountSlug, projectName, projectId } =
    useEpisodeContext();

  const characterIds = (episode.metadata?.character_ids as string[]) ?? [];
  const locationIds = (episode.metadata?.location_ids as string[]) ?? [];

  // Primary source: character/location names stored in metadata from season generation
  const metadataCharacterNames =
    (episode.metadata?.character_names as string[]) ?? [];
  const metadataLocationNames =
    (episode.metadata?.location_names as string[]) ?? [];

  // Fallback: Extract character names from story data if available
  const storyCharacters = episode.storyData?.characters ?? [];
  const storyCharacterNames = storyCharacters.map((c) => c.name);

  // Fallback: Extract location names from screenplay data if available
  const screenplayLocations = episode.screenplayData?.metadata?.locations ?? [];

  // Use metadata names first, then fallback to story/screenplay data
  const characterNames =
    metadataCharacterNames.length > 0
      ? metadataCharacterNames
      : storyCharacterNames;
  const locationNames =
    metadataLocationNames.length > 0
      ? metadataLocationNames
      : screenplayLocations;

  return (
    <header className="sticky top-0 z-20 bg-[#F5F5F7] px-6 py-2 dark:bg-[#0A0A0A]">
      {/* Top row: Breadcrumbs and Studio Switcher */}
      <div className="mb-2 flex items-center justify-between border-b border-gray-200/30 pb-2 dark:border-white/5">
        <div className="flex items-center gap-3">
          <Link
            href={`/home/${accountSlug}/studio/${projectSlug}/episodes`}
            className="rounded-full p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-[#A3A3A3] dark:hover:bg-[#1A1A1A] dark:hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <nav className="flex items-center text-xs text-gray-500 dark:text-[#A3A3A3]">
            <Link
              href={`/home/${accountSlug}/studio/${projectSlug}`}
              className="transition-colors hover:text-gray-900 dark:hover:text-white"
            >
              {projectName}
            </Link>
            <span className="mx-1.5 text-gray-300 dark:text-[#525252]">›</span>
            <Link
              href={`/home/${accountSlug}/studio/${projectSlug}/episodes`}
              className="transition-colors hover:text-gray-900 dark:hover:text-white"
            >
              Episodes
            </Link>
            <span className="mx-1.5 text-gray-300 dark:text-[#525252]">›</span>
            <span className="font-medium text-gray-900 dark:text-[#F5F5F5]">
              {episode.title}
            </span>
          </nav>
        </div>

        <div className="flex items-center gap-1.5">
          <StudioSwitcher />
          <button className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 dark:text-[#A3A3A3] dark:hover:bg-[#1A1A1A]">
            <MoreVertical className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Main content row - Title + metadata inline (Hidden in Editing Studio) */}
      {!isEditingStudio && (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white">
                {episode.title}
              </h1>
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                <Sparkles className="h-2.5 w-2.5" />
                {episode.status === 'draft'
                  ? 'Draft'
                  : episode.status === 'story'
                    ? 'Story'
                    : episode.status === 'storyboard'
                      ? 'Storyboard'
                      : episode.status === 'generating'
                        ? 'Generating'
                        : episode.status === 'editing'
                          ? 'Editing'
                          : episode.status === 'ready'
                            ? 'Ready'
                            : episode.status === 'published'
                              ? 'Published'
                              : 'Draft'}
              </span>
              <CanonHealthBadge projectId={projectId} />
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Ep {episode.number}
                {episode.season && ` • S${episode.season.number}`}
              </span>
            </div>
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              Updated {format(new Date(episode.updatedAt), 'M/d/yy, h:mm a')}
            </span>
          </div>

          {/* Description - condensed */}
          {episode.description && (
            <p className="line-clamp-1 max-w-2xl text-xs text-gray-500 dark:text-gray-400">
              {episode.description}
            </p>
          )}

          {/* Character/Location tags - smaller */}
          {(characterNames.length > 0 ||
            locationNames.length > 0 ||
            characterIds.length > 0 ||
            locationIds.length > 0) && (
              <TaggedAssets
                characterNames={characterNames}
                locationNames={locationNames}
                characterCount={characterIds.length}
                locationCount={locationIds.length}
              />
            )}
        </div>
      )}
    </header>
  );
}

interface TaggedAssetsProps {
  characterNames: string[];
  locationNames: string[];
  characterCount: number;
  locationCount: number;
}

function TaggedAssets({
  characterNames,
  locationNames,
  characterCount,
  locationCount,
}: TaggedAssetsProps) {
  const hasCharacterNames = characterNames.length > 0;
  const hasLocationNames = locationNames.length > 0;

  return (
    <div className="flex flex-wrap gap-1.5">
      {/* Show character names if available, otherwise fall back to count */}
      {hasCharacterNames
        ? characterNames.map((name, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-0.5 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:border-white/10 dark:bg-[#1A1A1A] dark:text-[#A3A3A3]"
          >
            <User className="h-2.5 w-2.5" />
            {name}
          </span>
        ))
        : characterCount > 0 && (
          <span className="inline-flex items-center gap-0.5 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:border-white/10 dark:bg-[#1A1A1A] dark:text-[#A3A3A3]">
            <User className="h-2.5 w-2.5" />
            {characterCount} character{characterCount !== 1 ? 's' : ''}
          </span>
        )}
      {/* Show location names if available, otherwise fall back to count */}
      {hasLocationNames
        ? locationNames.map((name, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-0.5 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:border-white/10 dark:bg-[#1A1A1A] dark:text-[#A3A3A3]"
          >
            <MapPin className="h-2.5 w-2.5" />
            {name}
          </span>
        ))
        : locationCount > 0 && (
          <span className="inline-flex items-center gap-0.5 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:border-white/10 dark:bg-[#1A1A1A] dark:text-[#A3A3A3]">
            <MapPin className="h-2.5 w-2.5" />
            {locationCount} location{locationCount !== 1 ? 's' : ''}
          </span>
        )}
    </div>
  );
}
