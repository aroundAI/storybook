'use client';

import Link from 'next/link';

import { ChevronLeft } from 'lucide-react';

import { ScrollArea } from '@kit/ui/scroll-area';
import { SidebarNavigation } from '@kit/ui/shadcn-sidebar';
import { Trans } from '@kit/ui/trans';
import { cn } from '@kit/ui/utils';

import { getStudioNavigationConfig } from '~/config/studio-navigation.config';

/**
 * Placeholder for GenerationStatusIndicator.
 * Full implementation is in FILM-903.
 */
function GenerationStatusIndicatorStub({
  compact: _compact,
}: {
  compact?: boolean;
}) {
  return null;
}

interface StudioSidebarProps {
  project: {
    id: string;
    name: string;
  };
  account: string;
}

/**
 * Studio sidebar navigation for project-level routes.
 * Uses the config-based navigation system to render routes.
 *
 * @param project - The current project with id and name
 * @param account - The account slug for URL building
 */
export function StudioSidebar({ project, account }: StudioSidebarProps) {
  const config = getStudioNavigationConfig({
    accountSlug: account,
    projectId: project.id,
  });

  return (
    <aside className="bg-muted/10 flex w-64 flex-col border-r">
      {/* Header with back navigation and project name */}
      <div className="flex h-14 items-center justify-between border-b px-4">
        <Link
          href={`/home/${account}/studio`}
          className={cn(
            'text-muted-foreground hover:text-foreground',
            'flex items-center gap-2 text-sm transition-colors',
          )}
        >
          <ChevronLeft className="h-4 w-4" />
          <Trans i18nKey="studio:sidebar.backToProjects" defaults="Back" />
        </Link>
        <span className="max-w-[120px] truncate font-medium">
          {project.name}
        </span>
      </div>

      {/* Navigation using config system */}
      <ScrollArea className="flex-1 py-4">
        <SidebarNavigation config={config} />
      </ScrollArea>

      {/* Generation Status placeholder - FILM-903 */}
      <div className="border-t p-4">
        <GenerationStatusIndicatorStub compact />
      </div>
    </aside>
  );
}
