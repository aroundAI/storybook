'use client';

import Link from 'next/link';
import { PublicProject, PublicEpisode } from '../server/public-queries';
import { Card, CardContent } from '@kit/ui/card';
import { PlayCircle } from 'lucide-react';
import { format } from 'date-fns';
import { ShareButton } from './share-button';

interface ProjectPageProps {
    project: PublicProject;
    episodes: PublicEpisode[];
    baseUrl: string;
}

export function ProjectPage({ project, episodes, baseUrl }: ProjectPageProps) {
    const accountSlug = project.account.slug;
    const projectUrl = `${baseUrl}/@${accountSlug}/${project.public_slug}`;

    return (
        <div className="min-h-screen bg-gray-50">
            <div className="bg-white border-b">
                <div className="container mx-auto px-4 py-8">
                    <div className="flex items-center gap-2 mb-4 text-sm text-gray-500">
                        <Link href={`/@${accountSlug}`} className="hover:text-gray-900">
                            {project.account.name}
                        </Link>
                        <span>/</span>
                        <span className="text-gray-900">{project.name}</span>
                    </div>

                    <div className="flex justify-between items-start">
                        <div>
                            <h1 className="text-3xl font-bold text-gray-900">{project.name}</h1>
                            <p className="mt-2 text-gray-600 max-w-3xl">
                                {project.description || 'No description provided.'}
                            </p>
                        </div>

                        <ShareButton url={projectUrl} title={project.name} />
                    </div>
                </div>
            </div>

            <div className="container mx-auto px-4 py-12">
                <h2 className="text-2xl font-bold mb-6">Episodes ({episodes.length})</h2>

                {episodes.length === 0 ? (
                    <div className="text-center py-12 bg-white rounded-lg border border-dashed text-gray-500">
                        No public episodes yet.
                    </div>
                ) : (
                    <div className="space-y-4">
                        {episodes.map((episode) => (
                            <Link
                                key={episode.id}
                                href={`/@${accountSlug}/${project.public_slug}/e/${episode.public_slug}`}
                                className="block group"
                            >
                                <Card className="hover:shadow-md transition-shadow">
                                    <CardContent className="p-4 flex gap-6">
                                        {/* Thumbnail */}
                                        <div className="w-48 h-28 bg-gray-200 rounded-md flex-shrink-0 relative overflow-hidden">
                                            {episode.thumbnail_url ? (
                                                <img src={episode.thumbnail_url} alt={episode.title} className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-gray-400">
                                                    <PlayCircle className="w-8 h-8" />
                                                </div>
                                            )}
                                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                                                <PlayCircle className="w-10 h-10 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                                            </div>
                                        </div>

                                        <div className="flex-1 py-1">
                                            <div className="flex justify-between items-start">
                                                <h3 className="text-lg font-semibold group-hover:text-blue-600 transition-colors">
                                                    {episode.number}. {episode.title}
                                                </h3>
                                                <span className="text-sm text-gray-500">
                                                    {format(new Date(episode.created_at), 'MMM d, yyyy')}
                                                </span>
                                            </div>
                                            <p className="text-gray-600 mt-2 line-clamp-2">
                                                {episode.description || 'No description.'}
                                            </p>
                                        </div>
                                    </CardContent>
                                </Card>
                            </Link>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
