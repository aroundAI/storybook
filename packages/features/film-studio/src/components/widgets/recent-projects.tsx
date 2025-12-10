'use client';

import Link from 'next/link';

import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Folder } from 'lucide-react';

import { Skeleton } from '@kit/ui/skeleton';

import { Widget } from '../dashboard-widgets';

interface RecentProject {
  id: string;
  name: string;
  updatedAt: string;
  episodeCount: number;
}

interface RecentProjectsWidgetProps {
  accountId: string;
  accountSlug: string;
  onRemove?: () => void;
}

export function RecentProjectsWidget({
  accountId,
  accountSlug,
  onRemove,
}: RecentProjectsWidgetProps) {
  const { data: projects, isLoading } = useQuery({
    queryKey: ['recent-projects', accountId],
    queryFn: async () => {
      // Client-side fetch with timeout and error handling
      // Note: Could be moved to a server action for better data fetching patterns
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(
          `/api/projects?accountId=${accountId}&limit=5`,
          { signal: controller.signal },
        );

        clearTimeout(timeoutId);

        if (!response.ok) {
          console.error(
            'Failed to fetch projects:',
            response.status,
            response.statusText,
          );
          return [];
        }

        return (await response.json()) as RecentProject[];
      } catch (error) {
        // Handle abort and network errors gracefully
        if (error instanceof Error && error.name !== 'AbortError') {
          console.error('Error fetching recent projects:', error);
        }
        return [];
      }
    },
    staleTime: 60000, // 1 minute
  });

  return (
    <Widget
      title="Recent Projects"
      action={{ label: 'View all', href: `/home/${accountSlug}/projects` }}
      onRemove={onRemove}
    >
      <div className="space-y-3">
        {isLoading && <ProjectsSkeleton />}

        {!isLoading &&
          projects?.map((project: RecentProject) => (
            <Link
              key={project.id}
              href={`/home/${accountSlug}/projects/${project.id}`}
              className="hover:bg-muted/50 -mx-2 flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors"
            >
              <div className="bg-muted rounded-md p-2">
                <Folder className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{project.name}</p>
                <p className="text-muted-foreground text-xs">
                  {project.episodeCount} episodes •{' '}
                  {formatDistanceToNow(new Date(project.updatedAt), {
                    addSuffix: true,
                  })}
                </p>
              </div>
            </Link>
          ))}

        {!isLoading && (!projects || projects.length === 0) && (
          <p className="text-muted-foreground py-4 text-center text-sm">
            No projects yet
          </p>
        )}
      </div>
    </Widget>
  );
}

function ProjectsSkeleton() {
  return (
    <>
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-md" />
          <div className="flex-1 space-y-1">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </>
  );
}
