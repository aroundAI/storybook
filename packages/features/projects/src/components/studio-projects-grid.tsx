'use client';

import { useMemo, useState } from 'react';

import Link from 'next/link';

import { isAfter, isThisMonth, isToday, startOfMonth } from 'date-fns';
import { Plus, Search } from 'lucide-react';

import { Input } from '@kit/ui/input';
import { cn } from '@kit/ui/utils';

import type { ProjectWithRole } from '../lib/types';
import { StudioProjectCard } from './studio-project-card';

interface StudioProjectsGridProps {
  projects: ProjectWithRole[];
  basePath: string;
}

// Group projects by date
interface ProjectGroup {
  title: string;
  projects: ProjectWithRole[];
}

function groupProjectsByDate(projects: ProjectWithRole[]): ProjectGroup[] {
  const today: ProjectWithRole[] = [];
  const earlierThisMonth: ProjectWithRole[] = [];
  const older: ProjectWithRole[] = [];

  const monthStart = startOfMonth(new Date());

  for (const project of projects) {
    const date = new Date(
      project.updated_at ?? project.created_at ?? Date.now(),
    );

    if (isToday(date)) {
      today.push(project);
    } else if (isThisMonth(date) && isAfter(date, monthStart)) {
      earlierThisMonth.push(project);
    } else {
      older.push(project);
    }
  }

  const groups: ProjectGroup[] = [];

  if (today.length > 0) {
    groups.push({ title: 'Today', projects: today });
  }
  if (earlierThisMonth.length > 0) {
    groups.push({ title: 'Earlier This Month', projects: earlierThisMonth });
  }
  if (older.length > 0) {
    groups.push({ title: 'Older', projects: older });
  }

  return groups;
}

/**
 * StudioProjectsGrid - Masonry grid layout with search and date grouping
 * Features:
 * - Masonry grid with CSS columns
 * - Search filtering
 * - Date-based grouping (Today, Earlier This Month, Older)
 * - New Project card as first item
 */
export function StudioProjectsGrid({
  projects,
  basePath,
}: StudioProjectsGridProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // Filter projects by search query
  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return projects;

    const query = searchQuery.toLowerCase();
    return projects.filter(
      (project) =>
        project.name.toLowerCase().includes(query) ||
        project.description?.toLowerCase().includes(query),
    );
  }, [projects, searchQuery]);

  // Group filtered projects by date
  const groupedProjects = useMemo(
    () => groupProjectsByDate(filteredProjects),
    [filteredProjects],
  );

  const hasNoResults = searchQuery && filteredProjects.length === 0;

  return (
    <div className="space-y-8">
      {/* Header with Search */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold sm:text-4xl">
            Film Studio Projects
          </h1>
          <p className="mt-2 text-muted-foreground">
            Your AI-generated video projects, organized by creation date.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative w-48">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search projects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              data-test="project-search-input"
            />
          </div>
          <Link
            href={`${basePath}/projects/new`}
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary/90"
            data-test="new-project-button"
          >
            <Plus className="mr-2 h-4 w-4" />
            New Project
          </Link>
        </div>
      </div>

      {/* No Results */}
      {hasNoResults && (
        <div className="py-12 text-center">
          <p className="text-muted-foreground">
            No projects found matching &quot;{searchQuery}&quot;
          </p>
        </div>
      )}

      {/* Empty State */}
      {projects.length === 0 && !searchQuery && (
        <div className="columns-1 gap-6 sm:columns-2 lg:columns-3 xl:columns-4">
          <NewProjectCard href={`${basePath}/projects/new`} />
        </div>
      )}

      {/* Project Groups */}
      {groupedProjects.map((group, groupIndex) => (
        <div key={group.title}>
          <h2 className="mb-6 text-2xl font-semibold">{group.title}</h2>
          <div className="columns-1 gap-6 sm:columns-2 lg:columns-3 xl:columns-4">
            {/* Show New Project card only in first group */}
            {groupIndex === 0 && !searchQuery && (
              <div className="mb-6 break-inside-avoid">
                <NewProjectCard href={`${basePath}/projects/new`} />
              </div>
            )}
            {group.projects.map((project) => (
              <div key={project.id} className="mb-6 break-inside-avoid">
                <StudioProjectCard
                  project={project}
                  href={`${basePath}/${project.slug ?? project.id}`}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// New Project Card Component
function NewProjectCard({ href }: { href: string }) {
  return (
    <Link href={href} className="group block">
      <div
        className={cn(
          'relative cursor-pointer overflow-hidden rounded-xl',
          'aspect-[4/3] min-h-[160px]',
          'bg-muted/50 dark:bg-muted/20',
          'border-2 border-dashed border-border',
          'hover:border-muted-foreground/50 hover:shadow-lg',
          'transition-all duration-200',
          'flex flex-col items-center justify-center p-4 text-center',
        )}
        data-test="new-project-card"
      >
        <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <Plus className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-medium">New Project</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Start a new video series
        </p>
      </div>
    </Link>
  );
}
