'use client';

import Link from 'next/link';
import { ArrowRight, Film, Users, MapPin, Clock } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Trans } from '@kit/ui/trans';
import { cn } from '@kit/ui/utils';

import type { ProjectWithRole } from '../lib/types';

interface ProjectCardProps {
  project: ProjectWithRole;
  href: string;
}

/**
 * ProjectCard - Cinema-styled project card with gradient accent and hover effects
 */
export function ProjectCard({ project, href }: ProjectCardProps) {
  const metadata = (project.metadata ?? {}) as {
    episode_count?: number;
    character_count?: number;
    location_count?: number;
    genre?: string;
  };

  const isActive = project.status === 'active';

  return (
    <Link href={href} className="block group">
      <Card
        className={cn(
          'relative overflow-hidden transition-all duration-300',
          'hover:-translate-y-1 hover:shadow-xl',
          'border-l-4',
          isActive ? 'border-l-primary' : 'border-l-muted-foreground/30'
        )}
        data-test={`project-card-${project.id}`}
      >
        {/* Gradient overlay on hover */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />

        <CardHeader className="relative pb-2">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-lg font-semibold truncate group-hover:text-primary transition-colors">
                {project.name}
              </CardTitle>
              {project.description && (
                <CardDescription className="mt-1.5 line-clamp-2 text-sm">
                  {project.description}
                </CardDescription>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {project.user_role && (
                <Badge variant="secondary" className="text-xs">
                  <Trans i18nKey={`projects:role.${project.user_role}`} />
                </Badge>
              )}
              <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
            </div>
          </div>
        </CardHeader>

        <CardContent className="relative pt-0">
          {/* Quick stats row */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3">
            {metadata.episode_count !== undefined && (
              <span className="flex items-center gap-1">
                <Film className="h-3 w-3" />
                {metadata.episode_count} episodes
              </span>
            )}
            {metadata.character_count !== undefined && (
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                {metadata.character_count}
              </span>
            )}
            {metadata.location_count !== undefined && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {metadata.location_count}
              </span>
            )}
          </div>

          {/* Status and metadata row */}
          <div className="flex items-center justify-between">
            {metadata.genre && (
              <span className="text-xs text-muted-foreground">
                {metadata.genre}
              </span>
            )}

            <Badge
              className={cn(
                'text-xs capitalize',
                isActive ? 'status-complete' : 'status-pending'
              )}
            >
              <Trans i18nKey={`projects:status.${project.status}`} />
            </Badge>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
