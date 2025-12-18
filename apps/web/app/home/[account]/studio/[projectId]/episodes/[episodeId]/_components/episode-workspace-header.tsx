'use client';

import Link from 'next/link';

import { format } from 'date-fns';
import { ArrowLeft, MapPin, MoreVertical, Sparkles, User } from 'lucide-react';

import { useEpisodeContext } from './episode-context-provider';
import { StudioSwitcher } from './studio-switcher';

export function EpisodeWorkspaceHeader() {
  const { episode, projectId, accountSlug, projectName } = useEpisodeContext();

  const characterIds = (episode.metadata?.character_ids as string[]) ?? [];
  const locationIds = (episode.metadata?.location_ids as string[]) ?? [];

  // Extract character names from story data if available
  const storyCharacters = episode.storyData?.characters ?? [];
  const characterNames = storyCharacters.map((c) => c.name);

  // Extract location names from screenplay data if available
  const screenplayLocations = episode.screenplayData?.metadata?.locations ?? [];

  return (
    <header className="sticky top-0 z-20 px-8 py-4">
      {/* Top row: Breadcrumbs and Studio Switcher */}
      <div className="mb-4 flex items-center justify-between border-b border-gray-200/30 pb-4 dark:border-gray-700/30">
        <div className="flex items-center gap-4">
          <Link
            href={`/home/${accountSlug}/studio/${projectId}/episodes`}
            className="rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <nav className="flex items-center text-sm text-gray-500 dark:text-gray-400">
            <Link
              href={`/home/${accountSlug}/studio/${projectId}`}
              className="transition-colors hover:text-gray-900 dark:hover:text-white"
            >
              {projectName}
            </Link>
            <span className="mx-2 text-gray-300 dark:text-gray-600">›</span>
            <Link
              href={`/home/${accountSlug}/studio/${projectId}/episodes`}
              className="transition-colors hover:text-gray-900 dark:hover:text-white"
            >
              Episodes
            </Link>
            <span className="mx-2 text-gray-300 dark:text-gray-600">›</span>
            <span className="font-medium text-gray-900 dark:text-white">
              {episode.title}
            </span>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <StudioSwitcher />
          <button className="rounded-md p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800">
            <MoreVertical className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Main content row */}
      <div className="space-y-2">
        {/* Title */}
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
          {episode.title}
        </h1>

        {/* Badge + Episode/Season + Last updated */}
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
            <Sparkles className="h-3 w-3" />
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
          <span>
            Episode {episode.number}
            {episode.season && ` • Season ${episode.season.number}`}
          </span>
          <span className="text-gray-400 dark:text-gray-500">
            Last updated: {format(new Date(episode.updatedAt), 'M/d/yyyy, h:mm:ss a')}
          </span>
        </div>

        {/* Description */}
        {episode.description && (
          <p className="max-w-2xl text-sm leading-relaxed text-gray-500 dark:text-gray-400">
            {episode.description}
          </p>
        )}

        {/* Character/Location tags */}
        {(characterNames.length > 0 ||
          screenplayLocations.length > 0 ||
          characterIds.length > 0 ||
          locationIds.length > 0) && (
          <TaggedAssets
            characterNames={characterNames}
            locationNames={screenplayLocations}
            characterCount={characterIds.length}
            locationCount={locationIds.length}
          />
        )}
      </div>
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
    <div className="flex flex-wrap gap-2">
      {/* Show character names if available, otherwise fall back to count */}
      {hasCharacterNames
        ? characterNames.map((name, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-600 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
            >
              <User className="h-3 w-3" />
              {name}
            </span>
          ))
        : characterCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-600 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
              <User className="h-3 w-3" />
              {characterCount} character{characterCount !== 1 ? 's' : ''}
            </span>
          )}
      {/* Show location names if available, otherwise fall back to count */}
      {hasLocationNames
        ? locationNames.map((name, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-600 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
            >
              <MapPin className="h-3 w-3" />
              {name}
            </span>
          ))
        : locationCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-600 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
              <MapPin className="h-3 w-3" />
              {locationCount} location{locationCount !== 1 ? 's' : ''}
            </span>
          )}
    </div>
  );
}
