'use client';

import Link from 'next/link';

import {
  Film,
  Globe,
  Instagram,
  Play,
  Sparkles,
  Twitter,
  Youtube,
} from 'lucide-react';

import { Button } from '@kit/ui/button';

import { PublicAccount, PublicProject } from '../server/public-queries';
import { GlassCard, GlassCardContent } from './ui/glass-card';
import { GradientBackground, HeroBackground } from './ui/gradient-background';

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
      <HeroBackground imageUrl={coverImageUrl} className="pt-20 pb-32">
        <div className="container mx-auto px-4">
          <div className="flex flex-col items-center gap-6 md:flex-row md:items-end">
            {/* Avatar */}
            <div className="relative">
              <div className="h-32 w-32 overflow-hidden rounded-full shadow-2xl ring-4 ring-black/50 md:h-40 md:w-40">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={company.picture_url || '/placeholder-avatar.png'}
                  alt={displayName}
                  className="h-full w-full bg-slate-800 object-cover"
                />
              </div>
              {/* Online indicator or verified badge could go here */}
            </div>

            {/* Studio Info */}
            <div className="flex-1 text-center md:text-left">
              <h1 className="mb-2 text-3xl font-bold text-slate-900 md:text-4xl dark:text-white">
                {displayName}
              </h1>
              {bio && (
                <p className="mb-4 max-w-2xl text-lg text-slate-700 dark:text-slate-300">
                  {bio}
                </p>
              )}

              {/* Social Links */}
              <div className="flex justify-center gap-3 md:justify-start">
                {profile?.website_url && (
                  <a
                    href={profile.website_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-slate-700 transition-colors hover:bg-slate-200 dark:border-white/10 dark:bg-white/10 dark:text-white dark:hover:bg-white/20"
                  >
                    <Globe className="h-5 w-5" />
                  </a>
                )}
                {social.twitter && (
                  <a
                    href={social.twitter}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white transition-colors hover:bg-blue-500/30 hover:text-blue-400"
                  >
                    <Twitter className="h-5 w-5" />
                  </a>
                )}
                {social.youtube && (
                  <a
                    href={social.youtube}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white transition-colors hover:bg-red-500/30 hover:text-red-400"
                  >
                    <Youtube className="h-5 w-5" />
                  </a>
                )}
                {social.instagram && (
                  <a
                    href={social.instagram}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white transition-colors hover:bg-pink-500/30 hover:text-pink-400"
                  >
                    <Instagram className="h-5 w-5" />
                  </a>
                )}
              </div>
            </div>

            {/* Stats */}
            <div className="flex gap-6 text-center">
              <div>
                <div className="text-3xl font-bold text-slate-900 dark:text-white">
                  {projects.length}
                </div>
                <div className="text-sm text-slate-600 dark:text-slate-400">
                  Shows
                </div>
              </div>
            </div>
          </div>
        </div>
      </HeroBackground>

      {/* Projects Grid */}
      <section className="relative z-10 container mx-auto -mt-20 px-4 pb-16">
        <h2 className="mb-8 text-2xl font-bold text-slate-900 dark:text-white">
          Shows
          <span className="ml-2 text-lg font-normal text-slate-600 dark:text-slate-400">
            ({projects.length})
          </span>
        </h2>

        {projects.length === 0 ? (
          <div className="py-16 text-center">
            <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
              <Film className="h-8 w-8 text-slate-400 dark:text-slate-500" />
            </div>
            <p className="text-lg text-slate-600 dark:text-slate-400">
              No public shows yet.
            </p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-500">
              Check back soon for new content!
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
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
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-100 px-4 py-2 text-sm text-indigo-600 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-400">
            <Sparkles className="h-4 w-4" />
            Create with AI
          </div>
          <h3 className="mb-2 text-2xl font-bold text-slate-900 dark:text-white">
            Start Your Own Studio
          </h3>
          <p className="mx-auto mb-6 max-w-md text-slate-600 dark:text-slate-400">
            Join thousands of creators using StoryBook to produce their next hit
            series.
          </p>
          <Button
            asChild
            size="lg"
            className="bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600"
          >
            <Link href="/auth/sign-up">Get Started Free</Link>
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
  const metadata = (project.metadata as any) || {};
  const coverUrl = metadata.cover_url;
  const glowColor = glowColors[glowIndex % glowColors.length];

  return (
    <Link
      href={`/@${companySlug}/${project.public_slug}`}
      className="group block"
    >
      <GlassCard
        glowColor={glowColor}
        glowPosition={glowIndex % 2 === 0 ? 'top-right' : 'bottom-left'}
      >
        {/* Cover Image */}
        <div className="relative aspect-video overflow-hidden rounded-t-2xl bg-slate-800">
          {coverUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={coverUrl}
              alt={project.name}
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-800">
              <Film className="h-16 w-16 text-slate-400 dark:text-slate-600" />
            </div>
          )}

          {/* Play overlay on hover */}
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/40">
            <div className="flex h-14 w-14 scale-75 transform items-center justify-center rounded-full bg-white/90 opacity-0 shadow-xl transition-all group-hover:scale-100 group-hover:opacity-100">
              <Play className="ml-1 h-6 w-6 fill-current text-black" />
            </div>
          </div>
        </div>

        {/* Project Info */}
        <GlassCardContent>
          <h3 className="text-lg font-semibold text-slate-900 transition-colors group-hover:text-indigo-600 dark:text-white dark:group-hover:text-indigo-400">
            {project.name}
          </h3>
          <p className="mt-1 line-clamp-2 text-sm text-slate-600 dark:text-slate-400">
            {project.description || 'No description provided.'}
          </p>
        </GlassCardContent>
      </GlassCard>
    </Link>
  );
}
