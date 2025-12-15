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

import { ArrowLeft, Check, ChevronDown, FolderOpen, Search } from 'lucide-react';

import { Button } from '@kit/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';
import { Input } from '@kit/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@kit/ui/tooltip';
import { cn } from '@kit/ui/utils';

interface Project {
    id: string;
    name: string;
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
    const navigateToProject = (projectId: string) => {
        setIsOpen(false);
        router.push(`/home/${accountSlug}/studio/${projectId}`);
    };

    return (
        <div className="flex flex-col border-b border-zinc-200 dark:border-white/5">
            {/* Back Navigation Row */}
            <div className="flex items-center px-4 pt-3 pb-1">
                <Link
                    href={`/home/${accountSlug}/studio`}
                    className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors"
                >
                    <ArrowLeft className="h-3 w-3" />
                    <span>Projects</span>
                </Link>
            </div>

            {/* Project Dropdown Row */}
            <div className="flex items-center px-4 pb-3 pt-1">
                <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            className={cn(
                                'flex w-full items-center justify-between gap-3 px-2 h-auto py-2',
                                'hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors',
                            )}
                        >
                            {/* CRITICAL: flex-1 min-w-0 allows text to wrap */}
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/10 border border-indigo-500/20 shrink-0">
                                    <FolderOpen className="h-5 w-5 text-indigo-500" />
                                </div>
                                {/* Text container with explicit wrapping rules */}
                                <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 break-words whitespace-normal leading-tight text-left">
                                        {currentProject.name}
                                    </span>
                                </div>
                            </div>
                            <ChevronDown
                                className={cn(
                                    'h-4 w-4 text-zinc-400 transition-transform shrink-0',
                                    isOpen && 'rotate-180',
                                )}
                            />
                        </Button>
                    </DropdownMenuTrigger>

                    <DropdownMenuContent
                        className="w-64 bg-white dark:bg-[#18181B] border-zinc-200 dark:border-white/10"
                        align="start"
                        sideOffset={8}
                    >
                        {/* Search */}
                        <div className="p-2">
                            <div className="relative">
                                <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                                <Input
                                    placeholder="Search projects..."
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className="h-8 pl-8 text-sm bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700"
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
                                <div className="px-2 py-1.5 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                                    Recent Projects
                                </div>
                                {filteredProjects
                                    .filter((p) => p.id !== currentProject.id)
                                    .slice(0, 5)
                                    .map((project) => (
                                        <DropdownMenuItem
                                            key={project.id}
                                            onClick={() => navigateToProject(project.id)}
                                            className="cursor-pointer hover:bg-zinc-100 dark:hover:bg-white/5"
                                        >
                                            <FolderOpen className="mr-2 h-4 w-4 text-zinc-400" />
                                            <span className="truncate text-zinc-700 dark:text-zinc-300">{project.name}</span>
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
