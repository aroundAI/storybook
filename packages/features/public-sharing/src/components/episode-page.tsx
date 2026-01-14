'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PublicEpisode, EpisodePlatformUrlsByLanguage } from '../server/public-queries';
import { ArrowLeft, Calendar, Globe } from 'lucide-react';
import { format } from 'date-fns';
import { ShareButton } from './share-button';
import { EmbedVideo, VideoPlatformBadge } from './embed-video';
import { GradientBackground } from './ui/gradient-background';
import { GlassCard, GlassCardContent } from './ui/glass-card';
import { cn } from '@kit/ui/utils';

interface EpisodePageProps {
    episode: PublicEpisode;
    platformUrls: EpisodePlatformUrlsByLanguage;
    language: string;
    baseUrl: string;
}

// Language display names
const languageNames: Record<string, string> = {
    en: 'English',
    hi: 'हिन्दी',
    es: 'Español',
    fr: 'Français',
    de: 'Deutsch',
    pt: 'Português',
    ja: '日本語',
    ko: '한국어',
    zh: '中文',
    ar: 'العربية',
    ru: 'Русский',
    it: 'Italiano',
};

function getLanguageName(code: string): string {
    return languageNames[code] || code.toUpperCase();
}

export function EpisodePage({ episode, platformUrls, language: initialLanguage, baseUrl }: EpisodePageProps) {
    const accountSlug = episode.project.account.slug;
    const projectSlug = episode.project.public_slug;
    const episodeUrl = `${baseUrl}/@${accountSlug}/${projectSlug}/e/${episode.slug}`;

    // State for selected language
    const [selectedLanguage, setSelectedLanguage] = useState(() => {
        // If the requested language is available, use it; otherwise use default
        if (platformUrls.languages.includes(initialLanguage)) {
            return initialLanguage;
        }
        return platformUrls.defaultLanguage || platformUrls.languages[0] || 'en';
    });

    // Get current platform URLs for selected language
    const currentUrls = platformUrls.urlsByLanguage[selectedLanguage] || { youtubeUrl: null, facebookUrl: null };

    // Determine which platform is being used
    const currentPlatform = currentUrls.youtubeUrl ? 'youtube' : currentUrls.facebookUrl ? 'facebook' : null;

    const hasMultipleLanguages = platformUrls.languages.length > 1;

    return (
        <GradientBackground>
            <div className="container mx-auto px-4 py-6">
                {/* Breadcrumb Navigation */}
                <div className="flex items-center gap-4 mb-8">
                    <Link
                        href={`/@${accountSlug}/${projectSlug}`}
                        className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to {episode.project.name}
                    </Link>
                </div>

                <div className="max-w-5xl mx-auto">
                    {/* Video Player */}
                    <div className="mb-8">
                        <EmbedVideo
                            youtubeUrl={currentUrls.youtubeUrl}
                            facebookUrl={currentUrls.facebookUrl}
                            title={episode.title}
                            className="shadow-2xl"
                        />
                    </div>

                    {/* Episode Info */}
                    <div className="flex flex-col lg:flex-row gap-8">
                        {/* Main Content */}
                        <div className="flex-1">
                            <div className="flex flex-wrap items-center gap-3 mb-4">
                                <span className="px-2 py-1 rounded bg-slate-100 dark:bg-white/10 text-xs font-medium text-slate-700 dark:text-white">
                                    Episode {episode.number}
                                </span>
                                {currentPlatform && (
                                    <VideoPlatformBadge platform={currentPlatform} />
                                )}
                            </div>

                            <h1 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white mb-4">
                                {episode.title}
                            </h1>

                            <div className="flex items-center gap-4 text-sm text-slate-600 dark:text-slate-400 mb-6">
                                <div className="flex items-center gap-2">
                                    <Calendar className="w-4 h-4" />
                                    {format(new Date(episode.created_at), 'MMMM d, yyyy')}
                                </div>
                            </div>

                            {episode.description && (
                                <div className="prose prose-slate dark:prose-invert max-w-none">
                                    <p className="text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                                        {episode.description}
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Sidebar */}
                        <div className="w-full lg:w-80 space-y-4">
                            {/* Language Selector */}
                            {hasMultipleLanguages && (
                                <GlassCard hover={false}>
                                    <GlassCardContent className="space-y-3">
                                        <div className="flex items-center gap-2 mb-3">
                                            <Globe className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                                            <h3 className="text-sm font-medium text-slate-900 dark:text-white">Audio Language</h3>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {platformUrls.languages.map((lang) => (
                                                <button
                                                    key={lang}
                                                    onClick={() => setSelectedLanguage(lang)}
                                                    className={cn(
                                                        'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                                                        selectedLanguage === lang
                                                            ? 'bg-indigo-500 text-white'
                                                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-300 dark:hover:bg-white/20'
                                                    )}
                                                >
                                                    {getLanguageName(lang)}
                                                </button>
                                            ))}
                                        </div>
                                    </GlassCardContent>
                                </GlassCard>
                            )}

                            {/* Share & Project Info */}
                            <GlassCard hover={false}>
                                <GlassCardContent className="space-y-4">
                                    <div>
                                        <h3 className="text-sm font-medium text-slate-900 dark:text-white mb-2">Share Episode</h3>
                                        <ShareButton
                                            url={episodeUrl}
                                            title={episode.title}
                                            className="w-full border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-white/20 dark:text-white dark:hover:bg-white/10"
                                        />
                                    </div>

                                    <div className="pt-4 border-t border-slate-200 dark:border-white/10">
                                        <h3 className="text-sm font-medium text-slate-900 dark:text-white mb-2">From</h3>
                                        <Link
                                            href={`/@${accountSlug}/${projectSlug}`}
                                            className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 hover:bg-slate-100 dark:bg-white/5 dark:hover:bg-white/10 transition-colors"
                                        >
                                            <div>
                                                <p className="font-medium text-slate-900 dark:text-white">{episode.project.name}</p>
                                                <p className="text-sm text-slate-600 dark:text-slate-400">{episode.project.account.name}</p>
                                            </div>
                                        </Link>
                                    </div>
                                </GlassCardContent>
                            </GlassCard>
                        </div>
                    </div>
                </div>
            </div>
        </GradientBackground>
    );
}
