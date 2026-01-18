'use client';

import Link from 'next/link';

import { Pencil, Play } from 'lucide-react';

import { Button } from '@kit/ui/button';

interface ProjectBannerProps {
  name: string;
  description: string;
  genre?: string;
  targetAudience?: string;
  format?: string;
  posterUrl?: string;
  backgroundUrl?: string;
  createdBy?: string;
  baseUrl?: string;
}

// Default Unsplash URLs for cinematic look
const DEFAULT_BACKDROP =
  'https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?q=80&w=2070&auto=format&fit=crop';
const DEFAULT_POSTER =
  'https://images.unsplash.com/photo-1536440136628-849c177e76a1?q=80&w=1025&auto=format&fit=crop';

/**
 * ProjectBanner - Cinematic hero matching Google Stitch design
 * Rounded container, Ages badge, Genre, Created by, Edit Details + Resume buttons
 */
export function ProjectBanner({
  name,
  description,
  genre,
  targetAudience,
  format,
  posterUrl,
  backgroundUrl,
  createdBy = 'Unknown',
  baseUrl,
}: ProjectBannerProps) {
  const backdrop = backgroundUrl || DEFAULT_BACKDROP;
  const poster = posterUrl || DEFAULT_POSTER;

  return (
    <div className="relative mb-6 h-[280px] overflow-hidden rounded-3xl border border-zinc-700/50">
      {/* Background Layer - Real image with gradient overlay */}
      <div className="absolute inset-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={backdrop} alt="" className="h-full w-full object-cover" />
        {/* Gradient overlay for text readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-zinc-900/70 to-zinc-900/30" />
      </div>

      {/* Content Layer - Bottom aligned */}
      <div className="relative z-10 flex h-full items-end gap-6 p-6">
        {/* Poster Art (2:3 ratio) */}
        <div className="hidden shrink-0 sm:block">
          <div className="aspect-[2/3] w-28 overflow-hidden rounded-xl border border-white/10 shadow-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={poster}
              alt={`${name} poster`}
              className="h-full w-full object-cover"
            />
          </div>
        </div>

        {/* Text Block */}
        <div className="min-w-0 flex-1">
          {/* Title */}
          <h1 className="mb-2 text-3xl font-bold text-white">{name}</h1>

          {/* Metadata row: Ages • Genre • Created by */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {/* Target audience badge */}
            {targetAudience && (
              <span className="rounded-md border border-zinc-700 bg-zinc-800/80 px-2.5 py-0.5 text-[11px] font-semibold text-white backdrop-blur">
                {targetAudience.includes('-')
                  ? `Ages ${targetAudience}`
                  : `Ages ${targetAudience}+`}
              </span>
            )}
            {/* Separator */}
            {targetAudience && (genre || format) && (
              <span className="text-zinc-500">•</span>
            )}
            {/* Genre and format */}
            {(genre || format) && (
              <span className="text-sm text-zinc-300">
                {[genre, format].filter(Boolean).join(', ')}
              </span>
            )}
            {/* Separator */}
            {(genre || format) && createdBy && (
              <span className="text-zinc-500">•</span>
            )}
            {/* Created by */}
            {createdBy && (
              <span className="text-sm text-zinc-300">
                Created by {createdBy}
              </span>
            )}
          </div>

          {/* Description/Premise */}
          {description && (
            <p className="line-clamp-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
              {description}
            </p>
          )}
        </div>

        {/* Action Buttons - Right side */}
        {baseUrl && (
          <div className="flex shrink-0 items-center gap-3">
            <Button
              variant="outline"
              asChild
              className="rounded-xl border-zinc-700 bg-zinc-800/80 text-white backdrop-blur hover:bg-zinc-700"
            >
              <Link href={`${baseUrl}/settings`}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit Details
              </Link>
            </Button>
            <Button
              asChild
              className="rounded-xl bg-indigo-500 text-white hover:bg-indigo-600"
            >
              <Link href={`${baseUrl}/episodes`}>
                <Play className="mr-2 h-4 w-4 fill-current" />
                Resume
              </Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
