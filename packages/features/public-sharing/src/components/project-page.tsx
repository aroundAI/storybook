'use client';

import Link from 'next/link';
import { PublicProject, PublicEpisode } from '../server/public-queries';
import { GradientBackground } from './ui/gradient-background';
import { ShowHero } from './show-hero';
import { EpisodeGrid } from './episode-grid';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { Button } from '@kit/ui/button';

interface ProjectPageProps {
    project: PublicProject;
    episodes: PublicEpisode[];
    baseUrl: string;
}

export function ProjectPage({ project, episodes, baseUrl }: ProjectPageProps) {
    const accountSlug = project.account.slug;
    const projectUrl = `${baseUrl}/@${accountSlug}/${project.public_slug}`;

    // Extract metadata from project
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metadata = project.metadata as any || {};
    const genre = metadata.genre || null;
    const targetAudience = metadata.target_audience || null;
    const coverImageUrl = metadata.cover_url || null;

    // Get first episode for "Watch Episode 1" CTA
    const firstEpisode = episodes.length > 0
        ? episodes.sort((a, b) => (a.number || 0) - (b.number || 0))[0]
        : null;

    return (
        <GradientBackground>
            {/* Breadcrumb Navigation */}
            <div className="container mx-auto px-4 pt-6">
                <Link
                    href={`/@${accountSlug}`}
                    className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors"
                >
                    <ArrowLeft className="w-4 h-4" />
                    {project.account.name}
                </Link>
            </div>

            {/* Show Hero Block */}
            <ShowHero
                title={project.name}
                logline={project.description}
                coverImageUrl={coverImageUrl}
                genre={genre}
                targetAudience={targetAudience}
                episodeCount={episodes.length}
                firstEpisodeSlug={firstEpisode?.slug}
                accountSlug={accountSlug || ''}
                projectSlug={project.public_slug || ''}
                shareUrl={projectUrl}
            />

            {/* Episodes Section */}
            <section className="container mx-auto px-4 py-12">
                <div className="flex items-center justify-between mb-8">
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                        Episodes
                        <span className="text-slate-600 dark:text-slate-400 font-normal ml-2 text-lg">
                            ({episodes.length})
                        </span>
                    </h2>
                </div>

                <EpisodeGrid
                    episodes={episodes.map(ep => ({
                        id: ep.id,
                        title: ep.title,
                        description: ep.description,
                        slug: ep.slug,
                        season_number: null, // Note: Could join with seasons table if needed
                        number: ep.number,
                        duration_seconds: ep.duration_seconds,
                        thumbnail_url: ep.thumbnail_url,
                    }))}
                    companySlug={accountSlug || ''}
                    projectSlug={project.public_slug || ''}
                />
            </section>

            {/* CTA Section */}
            <section className="border-t border-slate-200 dark:border-white/10 mt-12">
                <div className="container mx-auto px-4 py-16 text-center">
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400 text-sm mb-4 border border-indigo-200 dark:border-indigo-500/20">
                        <Sparkles className="w-4 h-4" />
                        Powered by StoryBook AI
                    </div>
                    <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                        Create Your Own Show
                    </h3>
                    <p className="text-slate-600 dark:text-slate-400 mb-6 max-w-md mx-auto">
                        Use AI to generate stories, screenplays, and visual content for your next hit series.
                    </p>
                    <Button
                        asChild
                        size="lg"
                        className="bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600"
                    >
                        <Link href="/auth/sign-up">
                            Get Started Free
                        </Link>
                    </Button>
                </div>
            </section>
        </GradientBackground>
    );
}
