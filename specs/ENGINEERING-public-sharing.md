# Engineering Specification: Public Sharing Platform

**Source PRD:** [PRD-public-sharing.md](file:///Users/shaurya/Work/projects/storybook/specs/PRD-public-sharing.md)  
**Created:** 2026-01-08  
**Status:** ✅ Implemented — PR #126 (2026-01-08). One item dropped and one
requirement unmet; see the Implementation Checklist.

---

## Overview

This document provides detailed engineering specifications for implementing the Public Sharing Platform feature, enabling creators to share projects and episodes publicly with SEO/AEO optimization.

---

## Phase 1: Database Migrations

### 1.1 Migration: Add Public Profile to Accounts

**File:** `apps/web/supabase/migrations/YYYYMMDD_public_sharing_accounts.sql`

```sql
-- Add public_profile JSONB column to accounts
ALTER TABLE public.accounts 
  ADD COLUMN IF NOT EXISTS public_profile JSONB DEFAULT '{}'::jsonb;

-- Add GIN index for JSONB queries
CREATE INDEX IF NOT EXISTS idx_accounts_public_profile 
  ON public.accounts USING GIN (public_profile);

-- Ensure slug is unique and not null for team accounts
ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_slug_unique UNIQUE (slug);

COMMENT ON COLUMN public.accounts.public_profile IS 
  'Public profile settings: {is_public, display_name, bio, website_url, social_links, custom_styles}';
```

---

### 1.2 Migration: Add Visibility to Projects

**File:** `apps/web/supabase/migrations/YYYYMMDD_public_sharing_projects.sql`

```sql
-- Add visibility column
ALTER TABLE public.projects 
  ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'private' 
  CHECK (visibility IN ('private', 'public', 'unlisted'));

-- Add public_slug (URL-safe identifier)
ALTER TABLE public.projects 
  ADD COLUMN IF NOT EXISTS public_slug TEXT;

-- Add SEO metadata
ALTER TABLE public.projects 
  ADD COLUMN IF NOT EXISTS seo_metadata JSONB DEFAULT '{}'::jsonb;

-- Unique constraint for public_slug per account
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_public_slug_account 
  ON public.projects(account_id, public_slug) 
  WHERE public_slug IS NOT NULL;

-- Index for visibility queries
CREATE INDEX IF NOT EXISTS idx_projects_visibility 
  ON public.projects(visibility) 
  WHERE visibility = 'public';

COMMENT ON COLUMN public.projects.visibility IS 'private=hidden, public=visible, unlisted=link-only';
COMMENT ON COLUMN public.projects.public_slug IS 'URL-safe slug for public pages';
```

---

### 1.3 Migration: Add Visibility and Localized Videos to Episodes

**File:** `apps/web/supabase/migrations/YYYYMMDD_public_sharing_episodes.sql`

```sql
-- Add visibility column (inherits from project by default)
ALTER TABLE public.episodes 
  ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'inherit' 
  CHECK (visibility IN ('inherit', 'private', 'public', 'unlisted'));

-- Add public_slug
ALTER TABLE public.episodes 
  ADD COLUMN IF NOT EXISTS public_slug TEXT;

-- Add SEO metadata
ALTER TABLE public.episodes 
  ADD COLUMN IF NOT EXISTS seo_metadata JSONB DEFAULT '{}'::jsonb;

-- Add localized videos (YT/FB per language)
ALTER TABLE public.episodes 
  ADD COLUMN IF NOT EXISTS localized_videos JSONB DEFAULT '{}'::jsonb;

-- Unique constraint for public_slug per project
CREATE UNIQUE INDEX IF NOT EXISTS idx_episodes_public_slug_project 
  ON public.episodes(project_id, public_slug) 
  WHERE public_slug IS NOT NULL;

-- GIN index for localized_videos language queries
CREATE INDEX IF NOT EXISTS idx_episodes_localized_videos 
  ON public.episodes USING GIN (localized_videos);

COMMENT ON COLUMN public.episodes.localized_videos IS 
  'Per-language video links: {"en": {"youtube": {...}, "facebook": {...}}}';
```

---

### 1.4 TypeScript Types

**File:** `packages/supabase/src/types/public-sharing.types.ts`

```typescript
// Public profile stored in accounts.public_profile
export interface PublicProfile {
  is_public: boolean;
  display_name?: string;
  bio?: string; // max 300 chars
  website_url?: string;
  social_links?: {
    youtube?: string;
    twitter?: string;
    instagram?: string;
    tiktok?: string;
  };
  custom_styles?: {
    primary_color?: string; // hex
    cover_image_url?: string;
  };
}

// SEO metadata stored in projects/episodes.seo_metadata
export interface SeoMetadata {
  title?: string; // override default
  description?: string; // override default
  keywords?: string[];
  thumbnail_url?: string;
}

// Localized video links stored in episodes.localized_videos
export interface LocalizedVideos {
  [languageCode: string]: {
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
}

// Visibility enum
export type Visibility = 'private' | 'public' | 'unlisted';
export type EpisodeVisibility = 'inherit' | Visibility;
```

---

## Phase 2: Public Routes

### 2.1 Route Structure

```
apps/web/app/
├── @[companySlug]/                    # Dynamic route group
│   ├── page.tsx                       # Company profile page
│   ├── layout.tsx                     # Public layout (no auth)
│   ├── opengraph-image.tsx            # Dynamic OG image
│   ├── [projectSlug]/
│   │   ├── page.tsx                   # Project page
│   │   ├── opengraph-image.tsx
│   │   └── e/
│   │       └── [episodeSlug]/
│   │           ├── page.tsx           # Episode page
│   │           └── opengraph-image.tsx
```

> **Note:** Next.js doesn't allow `@` in folder names directly. Use route groups:

**Alternative Structure:**

```
apps/web/app/
├── (public)/
│   └── [...slug]/                     # Catch-all for /@company/...
│       ├── page.tsx                   # Router component
│       └── layout.tsx
```

---

### 2.2 Route Handler Logic

**File:** `apps/web/app/(public)/[...slug]/page.tsx`

```typescript
import { notFound } from 'next/navigation';

interface Props {
  params: { slug: string[] };
  searchParams: { lang?: string };
}

export default async function PublicPage({ params, searchParams }: Props) {
  const slugParts = params.slug;
  
  // Validate @ prefix
  if (!slugParts[0]?.startsWith('@')) {
    notFound();
  }
  
  const companySlug = slugParts[0].slice(1); // Remove @
  
  // Route: /@company
  if (slugParts.length === 1) {
    return <CompanyPage companySlug={companySlug} />;
  }
  
  // Route: /@company/project
  if (slugParts.length === 2) {
    return <ProjectPage 
      companySlug={companySlug} 
      projectSlug={slugParts[1]} 
    />;
  }
  
  // Route: /@company/project/e/episode
  if (slugParts.length === 4 && slugParts[2] === 'e') {
    return <EpisodePage 
      companySlug={companySlug}
      projectSlug={slugParts[1]}
      episodeSlug={slugParts[3]}
      language={searchParams.lang}
    />;
  }
  
  notFound();
}
```

---

### 2.3 Public Layout (No Auth Required)

**File:** `apps/web/app/(public)/[...slug]/layout.tsx`

```typescript
import { PublicHeader } from './_components/public-header';
import { PublicFooter } from './_components/public-footer';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <PublicHeader />
      <main className="flex-1">{children}</main>
      <PublicFooter />
    </div>
  );
}
```

---

## Phase 3: Server Actions & Queries

### 3.1 Public Queries (No Auth)

**File:** `packages/features/public-sharing/src/server/public-queries.ts`

```typescript
'use server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

export async function getPublicCompany(slug: string) {
  const client = getSupabaseServerClient();
  
  const { data, error } = await client
    .from('accounts')
    .select(`
      id,
      name,
      slug,
      picture_url,
      public_profile
    `)
    .eq('slug', slug)
    .eq('public_profile->is_public', true)
    .single();
    
  if (error || !data) return null;
  return data;
}

export async function getPublicProjects(accountId: string) {
  const client = getSupabaseServerClient();
  
  const { data } = await client
    .from('projects')
    .select(`
      id,
      name,
      description,
      public_slug,
      cover_image_url,
      seo_metadata,
      created_at
    `)
    .eq('account_id', accountId)
    .eq('visibility', 'public')
    .order('created_at', { ascending: false });
    
  return data ?? [];
}

export async function getPublicProject(accountId: string, projectSlug: string) {
  const client = getSupabaseServerClient();
  
  const { data } = await client
    .from('projects')
    .select(`
      id,
      name,
      description,
      public_slug,
      cover_image_url,
      seo_metadata,
      account:accounts!inner(id, name, slug, picture_url)
    `)
    .eq('account_id', accountId)
    .eq('public_slug', projectSlug)
    .eq('visibility', 'public')
    .single();
    
  return data;
}

export async function getPublicEpisodes(projectId: string) {
  const client = getSupabaseServerClient();
  
  const { data } = await client
    .from('episodes')
    .select(`
      id,
      title,
      description,
      public_slug,
      season_number,
      episode_number,
      duration_seconds,
      localized_videos,
      created_at
    `)
    .eq('project_id', projectId)
    .or('visibility.eq.public,visibility.eq.inherit')
    .order('season_number', { ascending: true })
    .order('episode_number', { ascending: true });
    
  return data ?? [];
}

export async function getPublicEpisode(
  projectId: string, 
  episodeSlug: string
) {
  const client = getSupabaseServerClient();
  
  const { data } = await client
    .from('episodes')
    .select(`
      *,
      project:projects!inner(
        id, 
        name, 
        public_slug,
        account:accounts!inner(id, name, slug)
      )
    `)
    .eq('project_id', projectId)
    .eq('public_slug', episodeSlug)
    .or('visibility.eq.public,visibility.eq.inherit')
    .single();
    
  return data;
}
```

---

### 3.2 Admin Mutations (Auth Required)

**File:** `packages/features/public-sharing/src/server/visibility-actions.ts`

```typescript
'use server';

import { z } from 'zod';
import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

// Schema for updating public profile
const UpdatePublicProfileSchema = z.object({
  accountId: z.string().uuid(),
  publicProfile: z.object({
    is_public: z.boolean(),
    display_name: z.string().max(100).optional(),
    bio: z.string().max(300).optional(),
    website_url: z.string().url().optional().nullable(),
    social_links: z.object({
      youtube: z.string().optional(),
      twitter: z.string().optional(),
      instagram: z.string().optional(),
    }).optional(),
    custom_styles: z.object({
      primary_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      cover_image_url: z.string().url().optional(),
    }).optional(),
  }),
});

export const updatePublicProfileAction = enhanceAction(
  async (data) => {
    const client = getSupabaseServerClient();
    
    const { error } = await client
      .from('accounts')
      .update({ public_profile: data.publicProfile })
      .eq('id', data.accountId);
      
    if (error) throw error;
    return { success: true };
  },
  {
    schema: UpdatePublicProfileSchema,
    auth: true,
  }
);

// Schema for updating project visibility
const UpdateProjectVisibilitySchema = z.object({
  projectId: z.string().uuid(),
  visibility: z.enum(['private', 'public', 'unlisted']),
  publicSlug: z.string().regex(/^[a-z0-9-]+$/).min(3).max(50).optional(),
});

export const updateProjectVisibilityAction = enhanceAction(
  async (data) => {
    const client = getSupabaseServerClient();
    
    const { error } = await client
      .from('projects')
      .update({ 
        visibility: data.visibility,
        public_slug: data.publicSlug,
      })
      .eq('id', data.projectId);
      
    if (error) throw error;
    return { success: true };
  },
  {
    schema: UpdateProjectVisibilitySchema,
    auth: true,
  }
);

// Schema for updating episode localized videos
const UpdateLocalizedVideosSchema = z.object({
  episodeId: z.string().uuid(),
  localizedVideos: z.record(z.string(), z.object({
    youtube: z.object({
      video_id: z.string(),
      url: z.string().url(),
      channel_id: z.string(),
    }).optional(),
    facebook: z.object({
      video_id: z.string(),
      url: z.string().url(),
      page_id: z.string(),
    }).optional(),
  })),
});

export const updateLocalizedVideosAction = enhanceAction(
  async (data) => {
    const client = getSupabaseServerClient();
    
    const { error } = await client
      .from('episodes')
      .update({ localized_videos: data.localizedVideos })
      .eq('id', data.episodeId);
      
    if (error) throw error;
    return { success: true };
  },
  {
    schema: UpdateLocalizedVideosSchema,
    auth: true,
  }
);
```

---

## Phase 4: SEO & Metadata

### 4.1 Metadata Generation

**File:** `packages/features/public-sharing/src/lib/metadata.ts`

```typescript
import { Metadata } from 'next';
import appConfig from '~/config/app.config';

export function generateCompanyMetadata(company: PublicCompany): Metadata {
  const profile = company.public_profile;
  const title = `${profile.display_name || company.name} | StoryBook`;
  const description = profile.bio || `Explore content from ${company.name}`;
  const url = `${appConfig.url}/@${company.slug}`;
  
  return {
    title,
    description,
    openGraph: {
      type: 'profile',
      title,
      description,
      url,
      images: [company.picture_url || `${appConfig.url}/images/default-company.png`],
      username: company.slug,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
    alternates: {
      canonical: url,
    },
  };
}

export function generateProjectMetadata(project: PublicProject): Metadata {
  const seo = project.seo_metadata;
  const title = seo.title || `${project.name} | StoryBook`;
  const description = seo.description || project.description;
  const url = `${appConfig.url}/@${project.account.slug}/${project.public_slug}`;
  
  return {
    title,
    description,
    openGraph: {
      type: 'video.tv_show',
      title: project.name,
      description,
      url,
      images: [seo.thumbnail_url || project.cover_image_url],
    },
  };
}

export function generateEpisodeMetadata(
  episode: PublicEpisode,
  language: string
): Metadata {
  const seo = episode.seo_metadata;
  const video = episode.localized_videos[language];
  const title = seo.title || `${episode.title} | ${episode.project.name}`;
  const description = seo.description || episode.description;
  const url = `${appConfig.url}/@${episode.project.account.slug}/${episode.project.public_slug}/e/${episode.public_slug}`;
  
  return {
    title,
    description,
    openGraph: {
      type: 'video.episode',
      title,
      description,
      url,
      videos: video?.youtube ? [{
        url: video.youtube.url,
        width: 1920,
        height: 1080,
        type: 'video/mp4',
      }] : undefined,
    },
  };
}
```

---

### 4.2 JSON-LD Schema Generators

**File:** `packages/features/public-sharing/src/lib/structured-data.ts`

```typescript
export function getOrganizationSchema(company: PublicCompany) {
  const profile = company.public_profile;
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${appConfig.url}/@${company.slug}#organization`,
    name: profile.display_name || company.name,
    url: `${appConfig.url}/@${company.slug}`,
    logo: company.picture_url,
    description: profile.bio,
    sameAs: Object.values(profile.social_links || {}).filter(Boolean),
  };
}

export function getTVSeriesSchema(project: PublicProject, episodes: PublicEpisode[]) {
  const seasons = groupBy(episodes, 'season_number');
  return {
    '@context': 'https://schema.org',
    '@type': 'TVSeries',
    '@id': `${appConfig.url}/@${project.account.slug}/${project.public_slug}#series`,
    name: project.name,
    description: project.description,
    image: project.cover_image_url,
    numberOfEpisodes: episodes.length,
    numberOfSeasons: Object.keys(seasons).length,
    productionCompany: {
      '@type': 'Organization',
      '@id': `${appConfig.url}/@${project.account.slug}#organization`,
    },
    containsSeason: Object.entries(seasons).map(([num, eps]) => ({
      '@type': 'TVSeason',
      seasonNumber: parseInt(num),
      numberOfEpisodes: eps.length,
    })),
  };
}

export function getTVEpisodeSchema(episode: PublicEpisode, language: string) {
  const video = episode.localized_videos[language];
  return {
    '@context': 'https://schema.org',
    '@type': 'TVEpisode',
    '@id': `${appConfig.url}/@...#episode`,
    name: episode.title,
    description: episode.description,
    episodeNumber: episode.episode_number,
    seasonNumber: episode.season_number,
    datePublished: episode.created_at,
    partOfSeries: {
      '@type': 'TVSeries',
      '@id': `${appConfig.url}/@${episode.project.account.slug}/${episode.project.public_slug}#series`,
    },
    video: video?.youtube ? {
      '@type': 'VideoObject',
      name: episode.title,
      thumbnailUrl: episode.seo_metadata?.thumbnail_url,
      uploadDate: episode.created_at,
      duration: formatDuration(episode.duration_seconds),
      embedUrl: `https://youtube.com/embed/${video.youtube.video_id}`,
      contentUrl: video.youtube.url,
    } : undefined,
  };
}
```

---

## Phase 5: Sitemap & robots.txt

### 5.1 Extended Sitemap

**File:** `apps/web/app/sitemap.ts` (extend existing)

```typescript
// Add to existing sitemap.ts

async function getPublicCompanies(): Promise<MetadataRoute.Sitemap> {
  const client = getSupabaseServerClient();
  const { data } = await client
    .from('accounts')
    .select('slug, updated_at')
    .eq('public_profile->is_public', true)
    .eq('is_personal_account', false);
    
  return (data ?? []).map(c => ({
    url: `${baseUrl}/@${c.slug}`,
    lastModified: new Date(c.updated_at),
    changeFrequency: 'weekly',
    priority: 0.8,
  }));
}

async function getPublicProjectsAndEpisodes(): Promise<MetadataRoute.Sitemap> {
  const client = getSupabaseServerClient();
  
  // Projects
  const { data: projects } = await client
    .from('projects')
    .select('public_slug, updated_at, accounts!inner(slug)')
    .eq('visibility', 'public');
    
  const projectEntries = (projects ?? []).map(p => ({
    url: `${baseUrl}/@${p.accounts.slug}/${p.public_slug}`,
    lastModified: new Date(p.updated_at),
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }));
  
  // Episodes
  const { data: episodes } = await client
    .from('episodes')
    .select(`
      public_slug, 
      updated_at,
      projects!inner(public_slug, accounts!inner(slug), visibility)
    `)
    .not('public_slug', 'is', null)
    .eq('projects.visibility', 'public');
    
  const episodeEntries = (episodes ?? []).map(e => ({
    url: `${baseUrl}/@${e.projects.accounts.slug}/${e.projects.public_slug}/e/${e.public_slug}`,
    lastModified: new Date(e.updated_at),
    changeFrequency: 'monthly' as const,
    priority: 0.6,
  }));
  
  return [...projectEntries, ...episodeEntries];
}
```

---

### 5.2 robots.txt

**File:** `apps/web/app/robots.ts`

```typescript
import { MetadataRoute } from 'next';
import appConfig from '~/config/app.config';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/@'],
        disallow: ['/home/', '/admin/', '/api/', '/auth/'],
      },
      {
        userAgent: 'GPTBot',
        allow: ['/@'],
        disallow: ['/home/', '/admin/', '/api/'],
      },
      {
        userAgent: 'PerplexityBot',
        allow: ['/@'],
      },
      {
        userAgent: 'ClaudeBot',
        allow: ['/@'],
      },
    ],
    sitemap: `${appConfig.url}/sitemap.xml`,
  };
}
```

---

### 5.3 llms.txt

**File:** `apps/web/public/llms.txt`

```markdown
# StoryBook

> AI-powered video content platform for creators

## Public Content

- Company Profiles: /@{slug}
- Series/Projects: /@{slug}/{project}
- Episodes: /@{slug}/{project}/e/{episode}

## Content Structure

Each episode page contains:
- Title and description (first paragraph = summary)
- Video embed with duration
- Series/season/episode metadata
- Creator attribution

## Authoritative Data

For video content queries:
- Episode descriptions are canonical
- Use uploadDate from VideoObject schema for recency
- Cast and crew listed in schema.org metadata
```

---

## Phase 6: UI Components

### 6.1 File Structure

```
packages/features/public-sharing/
├── src/
│   ├── components/
│   │   ├── company-page.tsx
│   │   ├── project-page.tsx
│   │   ├── episode-page.tsx
│   │   ├── video-player.tsx
│   │   ├── language-selector.tsx
│   │   ├── share-button.tsx
│   │   ├── episode-list.tsx
│   │   └── project-grid.tsx
│   ├── server/
│   │   ├── public-queries.ts
│   │   └── visibility-actions.ts
│   ├── lib/
│   │   ├── metadata.ts
│   │   ├── structured-data.ts
│   │   └── sharing-utils.ts
│   └── index.ts
```

---

### 6.2 Language Selector Component

**File:** `packages/features/public-sharing/src/components/language-selector.tsx`

```typescript
'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@kit/ui/select';

const LANGUAGE_FLAGS: Record<string, string> = {
  en: '🇺🇸',
  es: '🇪🇸',
  hi: '🇮🇳',
  fr: '🇫🇷',
  de: '🇩🇪',
  pt: '🇧🇷',
  ja: '🇯🇵',
};

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Español',
  hi: 'हिन्दी',
  fr: 'Français',
  de: 'Deutsch',
  pt: 'Português',
  ja: '日本語',
};

interface Props {
  availableLanguages: string[];
  currentLanguage: string;
}

export function LanguageSelector({ availableLanguages, currentLanguage }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  
  const handleChange = (lang: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('lang', lang);
    router.push(`${pathname}?${params.toString()}`);
  };
  
  return (
    <Select value={currentLanguage} onValueChange={handleChange}>
      <SelectTrigger className="w-[160px]">
        <SelectValue>
          {LANGUAGE_FLAGS[currentLanguage]} {LANGUAGE_NAMES[currentLanguage]}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {availableLanguages.map(lang => (
          <SelectItem key={lang} value={lang}>
            {LANGUAGE_FLAGS[lang]} {LANGUAGE_NAMES[lang]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

---

### 6.3 Share Button Component

**File:** `packages/features/public-sharing/src/components/share-button.tsx`

```typescript
'use client';

import { Share2, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@kit/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';
import { toast } from '@kit/ui/sonner';

interface Props {
  canonicalUrl: string;
  youtubeUrl?: string;
  facebookUrl?: string;
  title: string;
}

export function ShareButton({ canonicalUrl, youtubeUrl, facebookUrl, title }: Props) {
  const [copied, setCopied] = useState(false);
  
  const copyLink = async () => {
    await navigator.clipboard.writeText(canonicalUrl);
    setCopied(true);
    toast.success('Link copied!');
    setTimeout(() => setCopied(false), 2000);
  };
  
  const shareToTwitter = () => {
    const url = youtubeUrl || canonicalUrl;
    window.open(
      `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`,
      '_blank'
    );
  };
  
  const shareToFacebook = () => {
    const url = facebookUrl || canonicalUrl;
    window.open(
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
      '_blank'
    );
  };
  
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Share2 className="h-4 w-4 mr-2" />
          Share
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={copyLink}>
          {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
          Copy Link
        </DropdownMenuItem>
        {youtubeUrl && (
          <DropdownMenuItem onClick={() => window.open(youtubeUrl, '_blank')}>
            📺 Share YouTube Video
          </DropdownMenuItem>
        )}
        {facebookUrl && (
          <DropdownMenuItem onClick={() => shareToFacebook()}>
            📘 Share Facebook Video
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={shareToTwitter}>
          🐦 Share on Twitter
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

---

## Implementation Checklist

### Phase 1: Foundation (Week 1-2)
- [x] Create database migrations
- [x] Generate TypeScript types after migrations
- [x] Create `@kit/public-sharing` package
- [x] Implement public queries (no auth)
- [x] Set up route structure

### Phase 2: Core Pages (Week 2-3)
- [x] Company page component
- [x] Project page component
- [x] Episode page with video embed
- [x] Language selector
- [x] Share button

### Phase 3: SEO/AEO (Week 3-4)
- [x] Metadata generation
- [x] JSON-LD schemas
- [ ] ~~Dynamic OG images~~ — dropped in bdb4ed01: an `opengraph-image` under
  the `[...slug]` catch-all breaks Next.js routing. Pages set `openGraph.images`
  from the account picture in `metadata.ts` instead.
- [x] Sitemap extension
- [x] robots.txt + llms.txt

### Phase 4: Settings UI (Week 4-5)
- [x] Public profile settings form
- [x] Project visibility toggle
- [x] Episode video link manager
- [x] Slug auto-generation

---

## Testing Requirements

| Test Type | Coverage |
|-----------|----------|
| Unit Tests | Public queries, metadata generation |
| Integration | Route rendering, OG tag generation |
| E2E | Full sharing flow, language switching — **not written**; no spec under `apps/e2e/tests` drives the public pages or the sharing flow |
| SEO Validation | Schema.org validator, OG debugger |
