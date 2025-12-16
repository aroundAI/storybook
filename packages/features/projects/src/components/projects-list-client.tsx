'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Film, Grid, List, Sparkles } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Trans } from '@kit/ui/trans';
import { cn } from '@kit/ui/utils';

import type { ProjectWithRole } from '../lib/types';
import { ProjectCard } from './project-card';

interface ProjectsListClientProps {
    projects: ProjectWithRole[];
    basePath: string;
}

/**
 * ProjectsListClient - Client component with view toggle and improved empty state
 * Server component wrapper handles data fetching
 */
export function ProjectsListClient({ projects, basePath }: ProjectsListClientProps) {
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

    // Empty state wizard for new users
    if (projects.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-center">
                {/* Animated icon */}
                <div className="relative mb-6">
                    <div className="absolute inset-0 animate-pulse rounded-full bg-primary/20 blur-xl" />
                    <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20">
                        <Film className="h-10 w-10 text-primary" />
                    </div>
                </div>

                <h3 className="text-xl font-semibold mb-2">
                    <Trans i18nKey="projects:emptyState" defaults="Create Your First Project" />
                </h3>

                <p className="text-muted-foreground max-w-md mb-8">
                    <Trans
                        i18nKey="projects:emptyStateDescription"
                        defaults="Start your creative journey by setting up a new film project. Add characters, locations, and bring your stories to life with AI."
                    />
                </p>

                <Button asChild variant="generate" size="lg" className="gap-2">
                    <Link href={`${basePath}/projects/new`}>
                        <Sparkles className="h-4 w-4" />
                        Create Your First Project
                    </Link>
                </Button>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* View toggle header */}
            <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                    {projects.length} project{projects.length !== 1 ? 's' : ''}
                </div>

                <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/50">
                    <Button
                        variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => setViewMode('grid')}
                        title="Grid view"
                    >
                        <Grid className="h-4 w-4" />
                    </Button>
                    <Button
                        variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => setViewMode('list')}
                        title="List view"
                    >
                        <List className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            {/* Projects grid/list */}
            <div className={cn(
                viewMode === 'grid'
                    ? 'grid gap-4 md:grid-cols-2 lg:grid-cols-3'
                    : 'flex flex-col gap-3'
            )}>
                {projects.map((project) => (
                    <ProjectCard
                        key={project.id}
                        project={project}
                        href={`${basePath}/${project.id}`}
                    />
                ))}
            </div>
        </div>
    );
}
