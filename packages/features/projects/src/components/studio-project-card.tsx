'use client';

import Image from 'next/image';
import Link from 'next/link';

import { formatDistanceToNow } from 'date-fns';
import { Clock, Film } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { cn } from '@kit/ui/utils';

import type { ProjectWithRole } from '../lib/types';

interface StudioProjectCardProps {
  project: ProjectWithRole;
  href: string;
}

// Status badge color mapping
const statusColors: Record<string, { bg: string; text: string }> = {
  active: { bg: 'bg-green-700', text: 'text-white' },
  archived: { bg: 'bg-red-700', text: 'text-white' },
  draft: { bg: 'bg-gray-600', text: 'text-white' },
  pending: { bg: 'bg-orange-700', text: 'text-white' },
};

// Generate gradient backgrounds for projects without cover images
function getGradientForProject(name: string): string {
  const gradients = [
    'from-indigo-600 to-purple-700',
    'from-blue-600 to-cyan-600',
    'from-emerald-600 to-teal-600',
    'from-orange-500 to-red-600',
    'from-pink-500 to-rose-600',
    'from-violet-600 to-purple-600',
    'from-slate-700 to-slate-900',
  ];
  const index = name.charCodeAt(0) % gradients.length;
  return gradients[index] ?? gradients[0]!;
}

/**
 * StudioProjectCard - Project card with cover image for film studio masonry grid
 * Features:
 * - Full cover image with gradient overlay
 * - Status badge
 * - Updated timestamp with user avatar
 * - Hover scale effect
 */
export function StudioProjectCard({ project, href }: StudioProjectCardProps) {
  const metadata = (project.metadata ?? {}) as {
    episode_count?: number;
    character_count?: number;
    coverImageUrl?: string;
    projectType?: string;
  };

  const coverImageUrl = metadata.coverImageUrl;
  const status = project.status || 'active';
  const statusStyle = statusColors[status] ?? statusColors.active;
  const userInitial = project.user_role?.[0]?.toUpperCase() ?? 'U';

  // Calculate aspect ratio based on project type for variety
  const aspectRatio =
    metadata.projectType === 'series' ? 'aspect-[3/4]' : 'aspect-[4/3]';

  return (
    <Link href={href} className="group block">
      <div
        className={cn(
          'relative cursor-pointer overflow-hidden rounded-xl shadow-sm',
          'transition-all duration-200 hover:shadow-lg',
          aspectRatio,
          'min-h-[180px]',
        )}
        data-test={`studio-project-card-${project.id}`}
      >
        {/* Cover Image or Gradient Fallback */}
        {coverImageUrl ? (
          <Image
            src={coverImageUrl}
            alt={`${project.name} cover`}
            fill
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
          />
        ) : (
          <div
            className={cn(
              'absolute inset-0 bg-gradient-to-br',
              getGradientForProject(project.name),
              'transition-transform duration-300 group-hover:scale-105',
            )}
          >
            {/* Large initial for projects without cover */}
            <div className="absolute inset-0 flex items-center justify-center">
              <Film className="h-16 w-16 text-white/30" />
            </div>
          </div>
        )}

        {/* Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />

        {/* Content */}
        <div className="absolute inset-0 flex flex-col justify-end p-4">
          {/* Title and Status */}
          <div className="mb-1 flex items-center justify-between gap-2">
            <h3 className="truncate text-lg font-semibold text-white drop-shadow-md">
              {project.name}
            </h3>
            <Badge
              className={cn(
                'shrink-0 text-xs capitalize',
                statusStyle?.bg,
                statusStyle?.text,
              )}
            >
              {status}
            </Badge>
          </div>

          {/* Timestamp and Avatar */}
          <div className="flex items-center justify-between text-xs text-gray-200">
            <p className="flex items-center gap-1 drop-shadow-md">
              <Clock className="h-3 w-3" />
              Updated{' '}
              {formatDistanceToNow(
                new Date(
                  project.updated_at ?? project.created_at ?? Date.now(),
                ),
                {
                  addSuffix: true,
                },
              )}
            </p>
            <div
              className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-200 text-[10px] font-bold text-gray-600 drop-shadow-md dark:bg-gray-600 dark:text-gray-300"
              title={`Role: ${project.user_role ?? 'Member'}`}
            >
              {userInitial}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
