'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Search } from 'lucide-react';
import { formatDistanceToNow, isToday, isThisMonth, startOfMonth, isAfter } from 'date-fns';

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
        const date = new Date(project.updated_at ?? project.created_at ?? Date.now());

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
export function StudioProjectsGrid({ projects, basePath }: StudioProjectsGridProps) {
    const [searchQuery, setSearchQuery] = useState('');

    // Filter projects by search query
    const filteredProjects = useMemo(() => {
        if (!searchQuery.trim()) return projects;

        const query = searchQuery.toLowerCase();
        return projects.filter(
            (project) =>
                project.name.toLowerCase().includes(query) ||
                project.description?.toLowerCase().includes(query)
        );
    }, [projects, searchQuery]);

    // Group filtered projects by date
    const groupedProjects = useMemo(
        () => groupProjectsByDate(filteredProjects),
        [filteredProjects]
    );

    const hasNoResults = searchQuery && filteredProjects.length === 0;

    return (
        <div className="space-y-8">
            {/* Header with Search */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl sm:text-4xl font-bold">Film Studio Projects</h1>
                    <p className="mt-2 text-muted-foreground">
                        Your AI-generated video projects, organized by creation date.
                    </p>
                </div>
                <div className="flex items-center gap-4">
                    <div className="relative w-48">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
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
                        className="inline-flex items-center px-4 py-2 rounded-md shadow-sm text-sm font-medium text-white bg-primary hover:bg-primary/90 transition-colors"
                        data-test="new-project-button"
                    >
                        <Plus className="mr-2 h-4 w-4" />
                        New Project
                    </Link>
                </div>
            </div>

            {/* No Results */}
            {hasNoResults && (
                <div className="text-center py-12">
                    <p className="text-muted-foreground">
                        No projects found matching &quot;{searchQuery}&quot;
                    </p>
                </div>
            )}

            {/* Empty State */}
            {projects.length === 0 && !searchQuery && (
                <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-6">
                    <NewProjectCard href={`${basePath}/projects/new`} />
                </div>
            )}

            {/* Project Groups */}
            {groupedProjects.map((group, groupIndex) => (
                <div key={group.title}>
                    <h2 className="text-2xl font-semibold mb-6">{group.title}</h2>
                    <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-6">
                        {/* Show New Project card only in first group */}
                        {groupIndex === 0 && !searchQuery && (
                            <div className="break-inside-avoid mb-6">
                                <NewProjectCard href={`${basePath}/projects/new`} />
                            </div>
                        )}
                        {group.projects.map((project) => (
                            <div key={project.id} className="break-inside-avoid mb-6">
                                <StudioProjectCard
                                    project={project}
                                    href={`${basePath}/${project.id}`}
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
        <Link href={href} className="block group">
            <div
                className={cn(
                    'relative rounded-xl overflow-hidden cursor-pointer',
                    'aspect-[4/3] min-h-[160px]',
                    'bg-muted/50 dark:bg-muted/20',
                    'border-2 border-dashed border-border',
                    'hover:border-muted-foreground/50 hover:shadow-lg',
                    'transition-all duration-200',
                    'flex flex-col items-center justify-center p-4 text-center'
                )}
                data-test="new-project-card"
            >
                <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-3">
                    <Plus className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-medium">New Project</h3>
                <p className="mt-1 text-sm text-muted-foreground">Start a new video series</p>
            </div>
        </Link>
    );
}
