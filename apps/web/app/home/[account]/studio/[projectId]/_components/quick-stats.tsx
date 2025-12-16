'use client';

/**
 * QuickStats Component - Stats with action buttons
 * Matches Google Stitch ActiveState-Overview design
 * All values fetched from database, no hardcoded values
 */
import Link from 'next/link';

import { Clapperboard, MapPin, Plus, Sparkles, Users } from 'lucide-react';

import { Button } from '@kit/ui/button';

interface QuickStatsProps {
  episodeCount: number;
  characterCount: number;
  locationCount: number;
  baseUrl?: string;
}

export function QuickStats({
  episodeCount,
  characterCount,
  locationCount,
  baseUrl,
}: QuickStatsProps) {
  const stats = [
    {
      label: 'EPISODES',
      value: episodeCount,
      icon: Clapperboard,
      iconColor: 'text-indigo-400',
      hoverBorder: 'hover:border-indigo-200 dark:hover:border-indigo-900',
      href: baseUrl ? `${baseUrl}/episodes` : undefined,
    },
    {
      label: 'CHARACTERS',
      value: characterCount,
      icon: Users,
      iconColor: 'text-purple-400',
      hoverBorder: 'hover:border-purple-200 dark:hover:border-purple-900',
      href: baseUrl ? `${baseUrl}/assets` : undefined,
    },
    {
      label: 'LOCATIONS',
      value: locationCount,
      icon: MapPin,
      iconColor: 'text-teal-400',
      hoverBorder: 'hover:border-teal-200 dark:hover:border-teal-900',
      href: baseUrl ? `${baseUrl}/assets` : undefined,
    },
  ];

  return (
    <div className="mb-6 flex items-center justify-between gap-4">
      {/* Stats Cards on Left */}
      <div className="flex gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          const content = (
            <div
              className={`group flex min-w-[140px] flex-col justify-between rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 ${stat.hoverBorder} cursor-pointer transition-colors`}
            >
              <div className="mb-2 flex items-start justify-between">
                <span className="text-xs font-medium tracking-wider text-zinc-500 uppercase dark:text-zinc-400">
                  {stat.label}
                </span>
                <Icon
                  className={`h-5 w-5 ${stat.iconColor} transition-transform group-hover:scale-110`}
                />
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold text-zinc-900 dark:text-white">
                  {stat.value}
                </span>
              </div>
            </div>
          );

          return stat.href ? (
            <Link key={stat.label} href={stat.href}>
              {content}
            </Link>
          ) : (
            <div key={stat.label}>{content}</div>
          );
        })}
      </div>

      {/* Action Buttons on Right */}
      {baseUrl && (
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            asChild
            className="rounded-xl border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <Link href={`${baseUrl}/assets`}>
              <Plus className="mr-2 h-4 w-4" />
              Add Asset
            </Link>
          </Button>
          <Button
            asChild
            className="rounded-xl bg-indigo-500 text-white shadow-lg shadow-indigo-500/25 hover:bg-indigo-600"
          >
            <Link href={`${baseUrl}/episodes`}>
              <Sparkles className="mr-2 h-4 w-4" />
              New Episode
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
