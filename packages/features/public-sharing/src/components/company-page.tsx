'use client';

import Link from 'next/link';
import { PublicAccount, PublicProject } from '../server/public-queries';
import { GlassCard, GlassCardContent } from './ui/glass-card';
import { GradientBackground, HeroBackground } from './ui/gradient-background';
import { Twitter, Youtube, Instagram, Globe, Play, Film, Sparkles } from 'lucide-react';
import { Button } from '@kit/ui/button';

interface CompanyPageProps {
    company: PublicAccount;
    projects: PublicProject[];
}

export function CompanyPage({ company, projects }: CompanyPageProps) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const profile = company.public_profile as any;
    const social = profile?.social_links || {};
    const customStyles = profile?.custom_styles || {};
    const displayName = profile?.display_name || company.name;
    const bio = profile?.bio;
    const coverImageUrl = customStyles?.cover_image_url;

    return (
        <GradientBackground>
            {/* Hero Section with Cover */}
            <HeroBackground
                imageUrl={coverImageUrl}
                className="pt-20 pb-32"
            >
                <div className="container mx-auto px-4">
                    <div className="flex flex-col md:flex-row items-center md:items-end gap-6">
                        {/* Avatar */}
                        <div className="relative">
                            <div className="w-32 h-32 md:w-40 md:h-40 rounded-full overflow-hidden ring-4 ring-black/50 shadow-2xl">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={company.picture_url || '/placeholder-avatar.png'}
                                    alt={displayName}
                                    className="w-full h-full object-cover bg-slate-800"
                                />
                            </div>
                            {/* Online indicator or verified badge could go here */}
                        </div>

                        {/* Studio Info */}
                        <div className="text-center md:text-left flex-1">
                            <h1 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white mb-2">
                                {displayName}
                            </h1>
                            {bio && (
                                <p className="text-slate-700 dark:text-slate-300 max-w-2xl mb-4 text-lg">
                                    {bio}
                                </p>
                            )}

                            {/* Social Links */}
                            <div className="flex justify-center md:justify-start gap-3">
                                {profile?.website_url && (
                                    <a
                                        href={profile.website_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-white/10 dark:text-white dark:hover:bg-white/20 transition-colors border border-slate-200 dark:border-white/10"
                                    >
                                        <Globe className="w-5 h-5" />
                                    </a>
                                )}
                                {social.twitter && (
                                    <a
                                        href={social.twitter}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-white/10 text-white hover:bg-blue-500/30 hover:text-blue-400 transition-colors border border-white/10"
                                    >
                                        <Twitter className="w-5 h-5" />
                                    </a>
                                )}
                                {social.youtube && (
                                    <a
                                        href={social.youtube}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-white/10 text-white hover:bg-red-500/30 hover:text-red-400 transition-colors border border-white/10"
                                    >
                                        <Youtube className="w-5 h-5" />
                                    </a>
                                )}
                                {social.instagram && (
                                    <a
                                        href={social.instagram}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-white/10 text-white hover:bg-pink-500/30 hover:text-pink-400 transition-colors border border-white/10"
                                    >
                                        <Instagram className="w-5 h-5" />
                                    </a>
                                )}
                            </div>
                        </div>

                        {/* Stats */}
                        <div className="flex gap-6 text-center">
                            <div>
                                <div className="text-3xl font-bold text-slate-900 dark:text-white">{projects.length}</div>
                                <div className="text-sm text-slate-600 dark:text-slate-400">Shows</div>
                            </div>
                        </div>
                    </div>
                </div>
            </HeroBackground>

            {/* Projects Grid */}
            <section className="container mx-auto px-4 -mt-20 relative z-10 pb-16">
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-8">
                    Shows
                    <span className="text-slate-600 dark:text-slate-400 font-normal ml-2 text-lg">
                        ({projects.length})
                    </span>
                </h2>

                {projects.length === 0 ? (
                    <div className="text-center py-16">
                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 mb-4">
                            <Film className="w-8 h-8 text-slate-400 dark:text-slate-500" />
                        </div>
                        <p className="text-slate-600 dark:text-slate-400 text-lg">No public shows yet.</p>
                        <p className="text-slate-500 dark:text-slate-500 text-sm mt-1">Check back soon for new content!</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {projects.map((project, idx) => (
                            <ProjectCard
                                key={project.id}
                                project={project}
                                companySlug={company.slug || ''}
                                glowIndex={idx}
                            />
                        ))}
                    </div>
                )}
            </section>

            {/* CTA Section */}
            <section className="border-t border-slate-200 dark:border-white/10">
                <div className="container mx-auto px-4 py-16 text-center">
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400 text-sm mb-4 border border-indigo-200 dark:border-indigo-500/20">
                        <Sparkles className="w-4 h-4" />
                        Create with AI
                    </div>
                    <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                        Start Your Own Studio
                    </h3>
                    <p className="text-slate-600 dark:text-slate-400 mb-6 max-w-md mx-auto">
                        Join thousands of creators using StoryBook to produce their next hit series.
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

interface ProjectCardProps {
    project: PublicProject;
    companySlug: string;
    glowIndex: number;
}

const glowColors = ['indigo', 'violet', 'teal', 'slate'] as const;

function ProjectCard({ project, companySlug, glowIndex }: ProjectCardProps) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metadata = project.metadata as any || {};
    const coverUrl = metadata.cover_url;
    const glowColor = glowColors[glowIndex % glowColors.length];

    return (
        <Link href={`/@${companySlug}/${project.public_slug}`} className="block group">
            <GlassCard
                glowColor={glowColor}
                glowPosition={glowIndex % 2 === 0 ? 'top-right' : 'bottom-left'}
            >
                {/* Cover Image */}
                <div className="aspect-video bg-slate-800 overflow-hidden rounded-t-2xl relative">
                    {coverUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                            src={coverUrl}
                            alt={project.name}
                            className="w-full h-full object-cover transition-transform group-hover:scale-105"
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-800">
                            <Film className="w-16 h-16 text-slate-400 dark:text-slate-600" />
                        </div>
                    )}

                    {/* Play overlay on hover */}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors">
                        <div className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transform scale-75 group-hover:scale-100 transition-all shadow-xl">
                            <Play className="w-6 h-6 text-black ml-1 fill-current" />
                        </div>
                    </div>
                </div>

                {/* Project Info */}
                <GlassCardContent>
                    <h3 className="font-semibold text-slate-900 dark:text-white text-lg group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                        {project.name}
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 line-clamp-2">
                        {project.description || 'No description provided.'}
                    </p>
                </GlassCardContent>
            </GlassCard>
        </Link>
    );
}
