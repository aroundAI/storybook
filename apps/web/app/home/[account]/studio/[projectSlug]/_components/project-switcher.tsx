'use client';

/**
 * ProjectSwitcher Component
 *
 * Dropdown-based project switcher with FIXED text wrapping.
 * Text wraps to 2 lines instead of truncating.
 */
import { useState } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import {
  ArrowLeft,
  Check,
  ChevronDown,
  FolderOpen,
  Search,
} from 'lucide-react';

import { Button } from '@kit/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';
import { Input } from '@kit/ui/input';
import { cn } from '@kit/ui/utils';

interface Project {
  id: string;
  name: string;
  slug: string | null;
  updated_at?: string;
}

interface ProjectSwitcherProps {
  currentProject: Project;
  accountSlug: string;
  recentProjects?: Project[];
}

export function ProjectSwitcher({
  currentProject,
  accountSlug,
  recentProjects = [],
}: ProjectSwitcherProps) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  // Filter projects by search
  const filteredProjects = recentProjects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()),
  );

  // Navigate to a project
  const navigateToProject = (projectSlug: string) => {
    setIsOpen(false);
    router.push(`/home/${accountSlug}/studio/${projectSlug}`);
  };

  return (
    <div className="flex flex-col border-b border-zinc-200 dark:border-white/5">
      {/* Back Navigation Row */}
      <div className="flex items-center px-4 pt-3 pb-1">
        <Link
          href={`/home/${accountSlug}/studio`}
          className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          <ArrowLeft className="h-3 w-3" />
          <span>Projects</span>
        </Link>
      </div>

      {/* Project Dropdown Row */}
      <div className="flex items-center px-4 pt-1 pb-3">
        <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className={cn(
                'flex h-auto w-full items-center justify-between gap-3 px-2 py-2',
                'transition-colors hover:bg-zinc-100 dark:hover:bg-white/5',
              )}
            >
              {/* CRITICAL: flex-1 min-w-0 allows text to wrap */}
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-indigo-500/20 bg-indigo-500/10">
                  <FolderOpen className="h-5 w-5 text-indigo-500" />
                </div>
                {/* Text container with explicit wrapping rules */}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-left text-sm leading-tight font-semibold break-words whitespace-normal text-zinc-900 dark:text-zinc-100">
                    {currentProject.name}
                  </span>
                </div>
              </div>
              <ChevronDown
                className={cn(
                  'h-4 w-4 shrink-0 text-zinc-400 transition-transform',
                  isOpen && 'rotate-180',
                )}
              />
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="w-64 border-zinc-200 bg-white dark:border-white/10 dark:bg-[#18181B]"
            align="start"
            sideOffset={8}
          >
            {/* Search */}
            <div className="p-2">
              <div className="relative">
                <Search className="absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <Input
                  placeholder="Search projects..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 border-zinc-200 bg-zinc-50 pl-8 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                />
              </div>
            </div>

            <DropdownMenuSeparator className="bg-zinc-200 dark:bg-white/5" />

            {/* Current Project */}
            <DropdownMenuItem
              className="flex items-center justify-between"
              disabled
            >
              <span className="truncate font-medium text-zinc-900 dark:text-white">
                {currentProject.name}
              </span>
              <Check className="h-4 w-4 text-indigo-500" />
            </DropdownMenuItem>

            <DropdownMenuSeparator className="bg-zinc-200 dark:bg-white/5" />

            {/* Recent Projects */}
            {filteredProjects.length > 0 ? (
              <>
                <div className="px-2 py-1.5 text-[10px] font-bold tracking-wider text-zinc-500 uppercase">
                  Recent Projects
                </div>
                {filteredProjects
                  .filter((p) => p.id !== currentProject.id)
                  .slice(0, 5)
                  .map((project) => (
                    <DropdownMenuItem
                      key={project.id}
                      onClick={() => navigateToProject(project.slug ?? project.id)}
                      className="cursor-pointer hover:bg-zinc-100 dark:hover:bg-white/5"
                    >
                      <FolderOpen className="mr-2 h-4 w-4 text-zinc-400" />
                      <span className="truncate text-zinc-700 dark:text-zinc-300">
                        {project.name}
                      </span>
                    </DropdownMenuItem>
                  ))}
              </>
            ) : search ? (
              <div className="px-2 py-4 text-center text-sm text-zinc-500">
                No projects found
              </div>
            ) : null}

            <DropdownMenuSeparator className="bg-zinc-200 dark:bg-white/5" />

            {/* View All Projects */}
            <DropdownMenuItem asChild>
              <Link
                href={`/home/${accountSlug}/studio`}
                className="flex items-center justify-center font-medium text-indigo-500"
              >
                View All Projects
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
