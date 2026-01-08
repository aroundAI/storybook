'use client';

import Link from 'next/link';
import { PublicEpisode } from '../server/public-queries';
import { Card } from '@kit/ui/card';
import { PlayCircle } from 'lucide-react';
import { format } from 'date-fns';
import { ShareButton } from './share-button';
import { LanguageSelector } from './language-selector';

interface EpisodePageProps {
    episode: PublicEpisode;
    language: string;
    baseUrl: string;
}

type LocalizedVideoData = {
    youtube?: {
        video_id: string;
        url: string;
        channel_id: string;
    };
    facebook?: {
        video_id: string;
        url: string;
        page_id: string;
    };
};

export function EpisodePage({ episode, language, baseUrl }: EpisodePageProps) {
    const accountSlug = episode.project.account.slug;
    const projectSlug = episode.project.public_slug;
    const episodeUrl = `${baseUrl}/@${accountSlug}/${projectSlug}/e/${episode.public_slug}`;

    // Cast localized_videos safely
    const localizedVideos = (episode.localized_videos || {}) as Record<string, LocalizedVideoData>;

    // Resolve video for current language
    // Fallback to 'en' if current not found? Or just show message?
    // PRD implies we should let user select available languages.
    // We should only show selector if there are multiple languages.

    const videoData = localizedVideos[language];
    const availableLanguages = Object.keys(localizedVideos);

    // If language requested doesn't exist, maybe fallback to first available?
    // But strictly we render what is asked. The Page route component might handle redirection or we just show "Select another language".
    // Better UX: if videoData is missing, try english, then first available. BUT show alert "Content not available in {language}".

    const effectiveVideoData = videoData || localizedVideos['en'] || Object.values(localizedVideos)[0];
    const isFallback = !videoData && !!effectiveVideoData;

    const embedUrl = (() => {
        if (!effectiveVideoData) return null;
        if (effectiveVideoData.youtube) {
            return `https://www.youtube.com/embed/${effectiveVideoData.youtube.video_id}?autoplay=0&rel=0`;
        }
        if (effectiveVideoData.facebook) {
            // FB needs encoded URL
            return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(effectiveVideoData.facebook.url)}&show_text=0&width=560`;
        }
        return null;
    })();

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            <div className="bg-white border-b">
                <div className="container mx-auto px-4 py-4">
                    <div className="flex items-center gap-2 mb-2 text-sm text-gray-500">
                        <Link href={`/@${accountSlug}`} className="hover:text-gray-900">
                            {episode.project.account.name}
                        </Link>
                        <span>/</span>
                        <Link href={`/@${accountSlug}/${projectSlug}`} className="hover:text-gray-900">
                            {episode.project.name}
                        </Link>
                    </div>
                </div>
            </div>

            <div className="flex-1 container mx-auto px-4 py-8">
                <div className="max-w-5xl mx-auto">
                    {/* Video Player Container */}
                    <div className="aspect-video bg-black rounded-xl overflow-hidden shadow-2xl relative">
                        {embedUrl ? (
                            <iframe
                                src={embedUrl}
                                className="w-full h-full"
                                allowFullScreen
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                title={episode.title}
                            />
                        ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-white bg-gray-900">
                                <PlayCircle className="w-16 h-16 text-gray-700 mb-4" />
                                <p className="text-gray-400">Video not available.</p>
                            </div>
                        )}
                    </div>

                    <div className="mt-8 flex flex-col md:flex-row gap-8 items-start justify-between">
                        <div className="flex-1">
                            <div className="flex items-center gap-4 mb-2">
                                <h1 className="text-2xl font-bold text-gray-900 leading-tight">
                                    {episode.number}. {episode.title}
                                </h1>
                                {isFallback && (
                                    <span className="bg-amber-100 text-amber-800 text-xs px-2 py-1 rounded-full">
                                        Language not available
                                    </span>
                                )}
                            </div>

                            <div className="text-sm text-gray-500 mb-6">
                                Published on {format(new Date(episode.created_at), 'MMMM d, yyyy')}
                            </div>

                            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
                                {episode.description || 'No description provided.'}
                            </p>
                        </div>

                        <div className="w-full md:w-72 flex flex-col gap-4">
                            <Card className="p-4">
                                <div className="flex flex-col gap-4">
                                    <div>
                                        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2 block">
                                            Audio Language
                                        </label>
                                        <LanguageSelector
                                            currentLanguage={videoData ? language : (effectiveVideoData ? (localizedVideos['en'] === effectiveVideoData ? 'en' : 'unknown') : language)}
                                            availableLanguages={availableLanguages}
                                        />
                                    </div>

                                    <div className="pt-4 border-t">
                                        <ShareButton url={episodeUrl} title={episode.title} className="w-full" />
                                    </div>
                                </div>
                            </Card>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
