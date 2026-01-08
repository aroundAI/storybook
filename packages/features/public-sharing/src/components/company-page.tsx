'use client';

import Link from 'next/link';
import { PublicAccount, PublicProject } from '../server/public-queries';
import { Card, CardHeader, CardTitle, CardDescription } from '@kit/ui/card';
import { Twitter, Youtube, Instagram, Globe } from 'lucide-react';

interface CompanyPageProps {
    company: PublicAccount;
    projects: PublicProject[];
}

export function CompanyPage({ company, projects }: CompanyPageProps) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const profile = company.public_profile as any; // Cast safely
    const social = profile?.social_links || {};
    const customStyles = profile?.custom_styles || {};

    return (
        <div className="min-h-screen bg-gray-50/50">
            {/* Hero / Cover */}
            <div
                className="h-48 md:h-64 bg-slate-900 w-full object-cover"
                style={{
                    backgroundColor: customStyles.primary_color ? customStyles.primary_color : undefined,
                    backgroundImage: customStyles.cover_image_url ? `url(${customStyles.cover_image_url})` : undefined,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                }}
            />

            <div className="container mx-auto px-4 -mt-16 relative z-10">
                <div className="flex flex-col md:flex-row gap-6 items-start">
                    {/* Avatar */}
                    <div className="bg-white p-1 rounded-full shadow-lg">
                        <img
                            src={company.picture_url || '/placeholder-avatar.png'}
                            alt={company.name}
                            className="w-32 h-32 rounded-full object-cover bg-gray-100"
                        />
                    </div>

                    <div className="flex-1 pt-16 md:pt-4">
                        <h1 className="text-3xl font-bold text-gray-900">{profile?.display_name || company.name}</h1>
                        {profile?.bio && (
                            <p className="mt-2 text-gray-600 max-w-2xl">{profile.bio}</p>
                        )}

                        <div className="flex gap-4 mt-4">
                            {profile?.website_url && (
                                <a href={profile.website_url} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-gray-900">
                                    <Globe className="w-5 h-5" />
                                </a>
                            )}
                            {social.twitter && (
                                <a href={social.twitter} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-blue-400">
                                    <Twitter className="w-5 h-5" />
                                </a>
                            )}
                            {social.youtube && (
                                <a href={social.youtube} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-red-500">
                                    <Youtube className="w-5 h-5" />
                                </a>
                            )}
                            {social.instagram && (
                                <a href={social.instagram} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-pink-600">
                                    <Instagram className="w-5 h-5" />
                                </a>
                            )}
                        </div>
                    </div>
                </div>

                {/* Projects Grid */}
                <div className="mt-12 mb-20">
                    <h2 className="text-xl font-semibold mb-6">Projects</h2>

                    {projects.length === 0 ? (
                        <div className="text-center py-12 bg-white rounded-lg border border-dashed text-gray-500">
                            No public projects yet.
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {projects.map((project) => (
                                <Link key={project.id} href={`/@${company.slug}/${project.public_slug}`}>
                                    <Card className="h-full hover:shadow-md transition-shadow cursor-pointer">
                                        <div className="aspect-video bg-gray-100 relative overflow-hidden rounded-t-lg">
                                            {/* Use project cover image if available in metadata or assets, fallback to placeholder */}
                                            <div className="absolute inset-0 flex items-center justify-center text-gray-400 bg-gray-100">
                                                {/* Placeholder logic or image */}
                                                Project Cover
                                            </div>
                                        </div>
                                        <CardHeader>
                                            <CardTitle className="text-lg">{project.name}</CardTitle>
                                            <CardDescription className="line-clamp-2">
                                                {project.description || 'No description provided.'}
                                            </CardDescription>
                                        </CardHeader>
                                    </Card>
                                </Link>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
