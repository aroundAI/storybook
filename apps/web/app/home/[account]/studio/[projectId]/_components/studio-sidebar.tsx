'use client';

import { ScrollArea } from '@kit/ui/scroll-area';
import { SidebarNavigation } from '@kit/ui/shadcn-sidebar';

import { getStudioNavigationConfig } from '~/config/studio-navigation.config';

import { ProjectSwitcher } from './project-switcher';

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

interface Project {
  id: string;
  name: string;
}

interface StudioSidebarProps {
  project: Project;
  account: string;
  recentProjects?: Array<{ id: string; name: string; updated_at?: string }>;
}

/**
 * Studio sidebar navigation for project-level routes.
 * Uses the config-based navigation system to render routes.
 *
 * @param project - The current project with id and name
 * @param account - The account slug for URL building
 * @param recentProjects - Recent projects for the switcher dropdown
 */
export function StudioSidebar({ project, account, recentProjects = [] }: StudioSidebarProps) {
  const config = getStudioNavigationConfig({
    accountSlug: account,
    projectId: project.id,
  });

  return (
    <aside className="flex w-[280px] flex-col border-r bg-white dark:bg-[#18181B] border-zinc-200 dark:border-white/5">
      {/* Project Switcher */}
      <ProjectSwitcher
        currentProject={project}
        accountSlug={account}
        recentProjects={recentProjects}
      />

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
