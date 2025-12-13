'use client';

/**
 * ProjectSwitcher Component
 *
 * A dropdown-based project switcher that replaces the cramped
 * "Back to Projects" + truncated project name header.
 *
 * Features:
 * - Full project name with icon
 * - Dropdown with recent projects
 * - Search functionality
 * - "View All Projects" link
 * - Ellipsis + tooltip for long names
 */

import { useEffect, useState } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Check, ChevronDown, FolderOpen, Search } from 'lucide-react';

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

    // Check if name is long (for tooltip)
    const isLongName = currentProject.name.length > 20;
    const truncatedName = isLongName
        ? `${currentProject.name.slice(0, 18)}...`
        : currentProject.name;

    return (
        <div className="flex h-14 items-center border-b px-3">
            <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="ghost"
                                    className={cn(
                                        'flex w-full items-center justify-between gap-2 px-2',
                                        'hover:bg-muted/50 transition-colors',
                                    )}
                                >
                                    <div className="flex items-center gap-2 overflow-hidden">
                                        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
                                            <FolderOpen className="h-4 w-4 text-primary" />
                                        </div>
                                        <span className="truncate font-semibold text-sm">
                                            {truncatedName}
                                        </span>
                                    </div>
                                    <ChevronDown
                                        className={cn(
                                            'h-4 w-4 text-muted-foreground transition-transform',
                                            isOpen && 'rotate-180',
                                        )}
                                    />
                                </Button>
                            </DropdownMenuTrigger>
                        </TooltipTrigger>
                        {isLongName && (
                            <TooltipContent side="right">
                                <p>{currentProject.name}</p>
                            </TooltipContent>
                        )}
                    </Tooltip>
                </TooltipProvider>

                <DropdownMenuContent
                    className="w-64"
                    align="start"
                    sideOffset={8}
                >
                    {/* Search */}
                    <div className="p-2">
                        <div className="relative">
                            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                placeholder="Search projects..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="h-8 pl-8 text-sm"
                            />
                        </div>
                    </div>

                    <DropdownMenuSeparator />

                    {/* Current Project */}
                    <DropdownMenuItem
                        className="flex items-center justify-between"
                        disabled
                    >
                        <span className="truncate font-medium">
                            {currentProject.name}
                        </span>
                        <Check className="h-4 w-4 text-primary" />
                    </DropdownMenuItem>

                    <DropdownMenuSeparator />

                    {/* Recent Projects */}
                    {filteredProjects.length > 0 ? (
                        <>
                            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                                Recent Projects
                            </div>
                            {filteredProjects
                                .filter((p) => p.id !== currentProject.id)
                                .slice(0, 5)
                                .map((project) => (
                                    <DropdownMenuItem
                                        key={project.id}
                                        onClick={() => navigateToProject(project.id)}
                                        className="cursor-pointer"
                                    >
                                        <FolderOpen className="mr-2 h-4 w-4 text-muted-foreground" />
                                        <span className="truncate">{project.name}</span>
                                    </DropdownMenuItem>
                                ))}
                        </>
                    ) : search ? (
                        <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                            No projects found
                        </div>
                    ) : null}

                    <DropdownMenuSeparator />

                    {/* View All Projects */}
                    <DropdownMenuItem asChild>
                        <Link
                            href={`/home/${accountSlug}/studio`}
                            className="flex items-center justify-center font-medium text-primary"
                        >
                            View All Projects
                        </Link>
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
