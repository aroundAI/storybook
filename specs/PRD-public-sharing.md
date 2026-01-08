# PRD: Public Sharing & Discovery Platform

**Document Version:** 1.0  
**Created:** 2026-01-08  
**Status:** Draft for Review

---

## Executive Summary

Enable creators to share their projects and content publicly through branded company pages with optimized discoverability for search engines (SEO), AI answer engines (AEO), and social media platforms.

---

## 1. Problem Statement

### Current State
- Projects and episodes are private/internal only
- No public-facing URLs for sharing content
- No way for creators to showcase their portfolio
- Content is invisible to search engines and AI platforms

### Desired State
- Public company profile pages with branding
- Shareable project showcase pages
- Individual episode pages with **multi-language video support** (YT/FB per language)
- Full SEO/AEO optimization for maximum discoverability

---

## 2. Goals & Success Metrics

| Goal | Metric | Target |
|------|--------|--------|
| Discoverability | Google Indexing Rate | >95% pages indexed |
| Social Engagement | Click-through from shares | >3% CTR |
| AI Citations | Mentions in ChatGPT/Gemini/Perplexity | Trackable presence |
| Creator Adoption | % using public profiles | >40% of active accounts |

---

## 3. User Stories

### 3.1 Creator Stories

| ID | Story | Priority |
|----|-------|----------|
| US-1 | As a creator, I want a public company page so viewers can discover all my projects | P0 |
| US-2 | As a creator, I want to choose which projects are public | P0 |
| US-3 | As a creator, I want to share episode links that show native YouTube/FB videos | P1 |
| US-4 | As a creator, I want my content found by AI assistants | P1 |

### 3.2 Viewer Stories

| ID | Story | Priority |
|----|-------|----------|
| VS-1 | As a viewer, I want to browse a creator's full catalog | P0 |
| VS-2 | As a viewer, I want to watch episodes directly from shared links | P0 |
| VS-3 | As a viewer, I want to share episodes to my social networks | P1 |

---

## 4. URL Structure Design

### 4.1 Proposed URL Hierarchy

```
https://storybook.ai/@{company-slug}                    # Company page
https://storybook.ai/@{company-slug}/{project-slug}      # Project page
https://storybook.ai/@{company-slug}/{project-slug}/e/{episode-slug}  # Episode page
```

### 4.2 URL Examples

```
Company:   https://storybook.ai/@little-detective
Project:   https://storybook.ai/@little-detective/dante-adventures
Episode:   https://storybook.ai/@little-detective/dante-adventures/e/the-missing-cookie
```

### 4.3 Alternative Options Considered

| Option | Example | Pros | Cons |
|--------|---------|------|------|
| **@ prefix** (Recommended) | `/@company` | Familiar (Twitter/IG), clean | Slight learning curve |
| Path prefix | `/c/company` | Very clear | Less elegant |
| Subdomain | `company.storybook.ai` | Professional | DNS complexity, SSL |
| No prefix | `/company` | Simplest | Collides with routes |

**Recommendation:** Use `@` prefix for social familiarity and clear namespace separation.

---

## 5. Database Schema Changes

### 5.1 Accounts Table (Modify)

```sql
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS
  public_profile JSONB DEFAULT '{}'::jsonb;

-- public_profile schema:
-- {
--   "is_public": boolean,
--   "display_name": string,
--   "bio": string (max 300 chars),
--   "website_url": string,
--   "social_links": { "youtube": string, "twitter": string, "instagram": string },
--   "custom_styles": { "primary_color": string, "cover_image_url": string }
-- }
```

### 5.2 Projects Table (Modify)

```sql
ALTER TABLE projects ADD COLUMN IF NOT EXISTS
  visibility text DEFAULT 'private' CHECK (visibility IN ('private', 'public', 'unlisted'));

ALTER TABLE projects ADD COLUMN IF NOT EXISTS
  public_slug text UNIQUE;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS
  seo_metadata JSONB DEFAULT '{}'::jsonb;

-- seo_metadata schema:
-- {
--   "title": string (override),
--   "description": string (override),
--   "keywords": string[],
--   "thumbnail_url": string
-- }
```

### 5.3 Episodes Table (Modify)

```sql
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS
  visibility text DEFAULT 'inherit' CHECK (visibility IN ('inherit', 'private', 'public', 'unlisted'));

ALTER TABLE episodes ADD COLUMN IF NOT EXISTS
  public_slug text;

ALTER TABLE episodes ADD COLUMN IF NOT EXISTS
  seo_metadata JSONB DEFAULT '{}'::jsonb;

ALTER TABLE episodes ADD COLUMN IF NOT EXISTS
  localized_videos JSONB DEFAULT '{}'::jsonb;

-- localized_videos schema (language-keyed, YT/FB only, NO shorts):
-- {
--   "en": {
--     "youtube": { "video_id": "abc123", "url": "https://youtube.com/watch?v=abc123", "channel_id": "UC..." },
--     "facebook": { "video_id": "456", "url": "https://facebook.com/watch?v=456", "page_id": "..." }
--   },
--   "es": {
--     "youtube": { "video_id": "xyz789", "url": "https://youtube.com/watch?v=xyz789", "channel_id": "UC..." },
--     "facebook": { "video_id": "789", "url": "https://facebook.com/watch?v=789", "page_id": "..." }
--   },
--   "hi": {
--     "youtube": { "video_id": "def456", "url": "...", "channel_id": "UC..." }
--   }
-- }
-- NOTE: Each language has its own YT/FB channel. No shorts, only full episodes.

-- Unique constraint per project
CREATE UNIQUE INDEX episodes_public_slug_project_idx 
  ON episodes(project_id, public_slug) WHERE public_slug IS NOT NULL;
```

---

## 6. Open Graph Protocol (OGP) Implementation

### 6.1 Company Page OGP

```html
<meta property="og:type" content="profile" />
<meta property="og:title" content="{Company Name} | StoryBook" />
<meta property="og:description" content="{Bio or default}" />
<meta property="og:image" content="{Company logo or cover}" />
<meta property="og:url" content="https://storybook.ai/@{slug}" />
<meta property="profile:username" content="{slug}" />
```

### 6.2 Project Page OGP

```html
<meta property="og:type" content="video.tv_show" />
<meta property="og:title" content="{Project Name}" />
<meta property="og:description" content="{Project description}" />
<meta property="og:image" content="{Project thumbnail 1200x630}" />
<meta property="og:url" content="https://storybook.ai/@{company}/{project}" />
```

### 6.3 Episode Page OGP (Platform-Aware)

**Priority Order for `og:video`:**
1. YouTube (if shared to YT) → Embed URL
2. Facebook (if shared to FB) → FB video URL
3. Self-hosted MP4 → Direct URL

```html
<!-- Type: video.episode for maximum compatibility -->
<meta property="og:type" content="video.episode" />
<meta property="og:title" content="{Episode Title} | {Project}" />
<meta property="og:description" content="{Episode description}" />
<meta property="og:image" content="{Episode thumbnail 1200x630}" />
<meta property="og:url" content="https://storybook.ai/@{company}/{project}/e/{episode}" />

<!-- Video metadata - Platform priority -->
<meta property="og:video" content="{video_url}" />
<meta property="og:video:secure_url" content="{video_url}" />
<meta property="og:video:type" content="video/mp4" />
<meta property="og:video:width" content="1920" />
<meta property="og:video:height" content="1080" />

<!-- Episode metadata -->
<meta property="video:series" content="{Project name}" />
<meta property="video:duration" content="{seconds}" />
```

---

## 7. SEO & AEO Optimization (Deep Research)

This section covers advanced strategies for maximizing discoverability by **search engines** (Google, Bing), **AI answer engines** (ChatGPT, Perplexity, Gemini), and **social platforms**.

---

### 7.1 AI Crawlers & robots.txt Configuration

#### Known AI Crawler User-Agents

| Crawler | Company | Purpose |
|---------|---------|---------|
| `GPTBot` | OpenAI | ChatGPT training & retrieval |
| `ChatGPT-User` | OpenAI | ChatGPT browsing mode |
| `ClaudeBot` | Anthropic | Claude training |
| `Google-Extended` | Google | Gemini/Bard training (not search) |
| `PerplexityBot` | Perplexity | Answer citations |
| `Applebot-Extended` | Apple | Siri/Apple Intelligence |

#### Recommended robots.txt

```txt
# Allow all AI crawlers for citation (maximize visibility)
User-agent: GPTBot
Allow: /@
Disallow: /home/
Disallow: /admin/
Disallow: /api/

User-agent: PerplexityBot
Allow: /@

User-agent: ClaudeBot
Allow: /@

User-agent: Google-Extended
Allow: /@

# Standard search crawlers
User-agent: *
Allow: /
Disallow: /home/
Disallow: /admin/

# Sitemap
Sitemap: https://storybook.ai/sitemap.xml
```

---

### 7.2 llms.txt - LLM-Specific Guidance

**llms.txt** is an emerging protocol (similar to robots.txt) that provides structured content specifically for LLM comprehension.

#### Location: `/llms.txt`

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
- Use `uploadDate` from VideoObject schema for recency
- Cast and crew are listed in schema.org metadata

## API Access

For programmatic access, use our public API:
- Docs: https://storybook.ai/docs/api
```

---

### 7.3 JSON-LD Structured Data Schemas

#### 7.3.1 Company Page Schema (Organization)

```json
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": "https://storybook.ai/@company#organization",
  "name": "Little Detective Studios",
  "url": "https://storybook.ai/@little-detective",
  "logo": {
    "@type": "ImageObject",
    "url": "https://storybook.ai/storage/@company/logo.png",
    "width": 512,
    "height": 512
  },
  "description": "Award-winning animation studio creating educational content for children.",
  "foundingDate": "2024",
  "sameAs": [
    "https://youtube.com/@littledetective",
    "https://twitter.com/littledetective",
    "https://instagram.com/littledetective"
  ]
}
```

#### 7.3.2 Project Page Schema (TVSeries)

```json
{
  "@context": "https://schema.org",
  "@type": "TVSeries",
  "@id": "https://storybook.ai/@company/project#series",
  "name": "Dante Adventures",
  "alternateName": "Detective Dante",
  "description": "Follow Dante the detective dog as he solves mysteries in Puzzletown. Educational mystery series for ages 4-8.",
  "image": "https://storybook.ai/storage/@company/project/cover.jpg",
  "genre": ["Animation", "Kids", "Mystery", "Educational"],
  "numberOfSeasons": 2,
  "numberOfEpisodes": 24,
  "dateCreated": "2025-06-01",
  "inLanguage": "en",
  "productionCompany": {
    "@type": "Organization",
    "@id": "https://storybook.ai/@company#organization"
  },
  "containsSeason": [
    {
      "@type": "TVSeason",
      "@id": "https://storybook.ai/@company/project#season1",
      "seasonNumber": 1,
      "numberOfEpisodes": 12,
      "name": "Season 1: Puzzletown Mysteries"
    }
  ],
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "4.8",
    "ratingCount": "1250"
  }
}
```

#### 7.3.3 Episode Page Schema (TVEpisode + VideoObject)

```json
{
  "@context": "https://schema.org",
  "@type": "TVEpisode",
  "@id": "https://storybook.ai/@company/project/e/episode#episode",
  "name": "The Missing Cookie",
  "description": "When cookies vanish from the bakery, Dante uses his detective skills to find clues. He teaches viewers about observation and logical thinking.",
  "episodeNumber": 1,
  "seasonNumber": 1,
  "datePublished": "2025-06-15",
  "partOfSeries": {
    "@type": "TVSeries",
    "@id": "https://storybook.ai/@company/project#series"
  },
  "partOfSeason": {
    "@type": "TVSeason",
    "@id": "https://storybook.ai/@company/project#season1"
  },
  "video": {
    "@type": "VideoObject",
    "@id": "https://storybook.ai/@company/project/e/episode#video",
    "name": "The Missing Cookie | Dante Adventures S01E01",
    "description": "Dante solves the mystery of the missing cookies at the Puzzletown bakery.",
    "thumbnailUrl": [
      "https://storybook.ai/storage/thumbnails/1x1.jpg",
      "https://storybook.ai/storage/thumbnails/4x3.jpg",
      "https://storybook.ai/storage/thumbnails/16x9.jpg"
    ],
    "uploadDate": "2025-06-15T00:00:00Z",
    "duration": "PT5M30S",
    "contentUrl": "https://youtube.com/watch?v=xyz",
    "embedUrl": "https://youtube.com/embed/xyz",
    "interactionStatistic": {
      "@type": "InteractionCounter",
      "interactionType": "https://schema.org/WatchAction",
      "userInteractionCount": 15000
    },
    "regionsAllowed": "US,CA,GB,AU"
  },
  "hasPart": [
    {
      "@type": "Clip",
      "name": "Introduction",
      "startOffset": 0,
      "endOffset": 30,
      "url": "https://youtube.com/watch?v=xyz&t=0"
    },
    {
      "@type": "Clip",
      "name": "Finding Clues",
      "startOffset": 30,
      "endOffset": 180,
      "url": "https://youtube.com/watch?v=xyz&t=30"
    }
  ]
}
```

#### 7.3.4 FAQPage Schema (For Series Info)

```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What is Dante Adventures about?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Dante Adventures is an educational mystery series following Dante the detective dog as he solves puzzles in Puzzletown. Designed for children ages 4-8, each episode teaches problem-solving and critical thinking skills."
      }
    },
    {
      "@type": "Question",
      "name": "How many episodes are there?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "There are currently 24 episodes across 2 seasons. Season 1 has 12 episodes and Season 2 has 12 episodes."
      }
    }
  ]
}
```

---

### 7.4 Content Formatting for AI Citation

#### How AI Engines Select Sources

Based on research into ChatGPT, Perplexity, and Gemini citation patterns:

| Factor | Weight | Implementation |
|--------|--------|----------------|
| **Credibility** | High | Author bios, E-E-A-T signals, ratings |
| **Recency** | High | Visible dates, frequent updates |
| **Clarity** | High | Direct answers, short paragraphs |
| **Structure** | Medium | Headings, lists, tables |
| **Keyword Match** | Medium | Semantic relevance to query |

#### Content Structure Best Practices

1. **TL;DR First:** Start every description with a 1-2 sentence summary:
   ```
   "The Missing Cookie" is Episode 1 of Dante Adventures, where Dante
   teaches observation skills while solving a bakery mystery.
   ```

2. **Inverted Pyramid:** Most important info first, details later

3. **Q&A Format:** Use question headings for common queries:
   ```markdown
   ## What age is Dante Adventures for?
   Dante Adventures is designed for children ages 4-8...
   ```

4. **Lists & Tables:** Structure data for easy extraction:
   ```markdown
   **Episode Details:**
   - Duration: 5 minutes 30 seconds
   - Season: 1, Episode: 1
   - Release Date: June 15, 2025
   ```

5. **Quotable Statements:** Write descriptions AI can cite directly:
   ```
   "Dante Adventures is an award-winning educational mystery series
   that has been viewed over 10 million times."
   ```

---

### 7.5 Video SEO Best Practices

#### VideoObject Required Properties

| Property | Description | Example |
|----------|-------------|---------|
| `name` | Video title | "The Missing Cookie" |
| `thumbnailUrl` | High-res thumbnail (1280x720 min) | Direct URL |
| `uploadDate` | ISO 8601 date | "2025-06-15T00:00:00Z" |
| `duration` | ISO 8601 duration | "PT5M30S" |
| `contentUrl` | Direct video file/watch URL | YouTube URL |
| `embedUrl` | Embeddable URL | YouTube embed URL |

#### Video Sitemap (video-sitemap.xml)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  <url>
    <loc>https://storybook.ai/@company/project/e/episode</loc>
    <video:video>
      <video:thumbnail_loc>https://.../thumb.jpg</video:thumbnail_loc>
      <video:title>The Missing Cookie</video:title>
      <video:description>Dante solves...</video:description>
      <video:content_loc>https://youtube.com/watch?v=xyz</video:content_loc>
      <video:duration>330</video:duration>
      <video:publication_date>2025-06-15</video:publication_date>
      <video:family_friendly>yes</video:family_friendly>
    </video:video>
  </url>
</urlset>
```

---

### 7.6 Perplexity & ChatGPT Citation Optimization

#### Perplexity Ranking Factors (Research-Based)

1. **Curated Source Pool:** Perplexity maintains trusted domains
2. **Three-Layer Reranker:** ML model for relevance scoring
3. **Recency Preference:** Content updated within 30 days ranks higher
4. **Community Content:** Reddit/forums cited for opinions
5. **List Format:** Listicle structures frequently cited

#### ChatGPT Web Browsing Mode

1. **Real-Time Search:** Searches web for current queries
2. **Freshness Signals:** Prefers recently updated content
3. **Structured Data:** Uses schema.org for entity understanding
4. **Citation Style:** Links to source with title + summary

#### Optimization Checklist

- [ ] Add visible `Last Updated: {date}` on all pages
- [ ] Include JSON-LD with `dateModified` property
- [ ] Start descriptions with direct answers
- [ ] Use question-based H2 headings
- [ ] Add FAQ schema for common questions
- [ ] Ensure PerplexityBot and GPTBot allowed in robots.txt
- [ ] Create `/llms.txt` with site structure guide

---

### 7.7 Social Platform Meta Tags

#### Twitter Card (Video)

```html
<meta name="twitter:card" content="player" />
<meta name="twitter:site" content="@storybook" />
<meta name="twitter:title" content="The Missing Cookie | Dante Adventures" />
<meta name="twitter:description" content="Dante solves..." />
<meta name="twitter:player" content="https://youtube.com/embed/xyz" />
<meta name="twitter:player:width" content="1280" />
<meta name="twitter:player:height" content="720" />
<meta name="twitter:image" content="https://.../thumb.jpg" />
```

#### LinkedIn OGP

```html
<meta property="og:type" content="video.episode" />
<meta property="og:title" content="The Missing Cookie | Dante Adventures" />
<meta property="og:description" content="..." />
<meta property="og:image" content="https://.../thumb-1200x627.jpg" />
<meta property="og:video" content="https://youtube.com/embed/xyz" />
```

---

## 8. Multi-Language Video Serving & Sharing

### 8.1 Language Selection UX

Each episode can have videos in multiple languages, served from **different YT/FB channels per language**:

```
┌─────────────────────────────────────────────────────┐
│ [VIDEO PLAYER - Currently: English]                │
│ ┌─────────────────────────────────────────────────┐ │
│ │         [YouTube/FB Embed]                      │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ Language: [🇺🇸 English ▼]                           │
│           ├── 🇺🇸 English                           │
│           ├── 🇪🇸 Spanish                           │
│           ├── 🇮🇳 Hindi                             │
│           └── 🇫🇷 French                            │
│                                                     │
│ [▶ Watch on YouTube]  [📘 Watch on Facebook]       │
└─────────────────────────────────────────────────────┘
```

### 8.2 Video Source Priority

**Per Language, prioritize:**
1. **YouTube** (best embed support, SEO, AI discoverability)
2. **Facebook** (fallback if no YT for that language)

```typescript
type LocalizedVideos = {
  [languageCode: string]: {
    youtube?: { video_id: string; url: string; channel_id: string };
    facebook?: { video_id: string; url: string; page_id: string };
  };
};

function getVideoForLanguage(
  episode: Episode, 
  language: string
): { platform: 'youtube' | 'facebook'; url: string } | null {
  const videos = episode.localized_videos[language];
  if (!videos) return null;
  
  // Prefer YouTube, fallback to Facebook
  if (videos.youtube?.url) {
    return { platform: 'youtube', url: videos.youtube.url };
  }
  if (videos.facebook?.url) {
    return { platform: 'facebook', url: videos.facebook.url };
  }
  return null;
}
```

### 8.3 Sharing Logic (Language-Aware)

When sharing, **share the native platform URL for the selected language**:

```typescript
function getShareUrl(
  episode: Episode, 
  platform: 'facebook' | 'twitter' | 'linkedin',
  selectedLanguage: string
): string {
  const videos = episode.localized_videos[selectedLanguage];
  
  if (platform === 'facebook' && videos?.facebook?.url) {
    // Share native FB video (plays inline on FB)
    return videos.facebook.url;
  }
  
  if ((platform === 'twitter' || platform === 'linkedin') && videos?.youtube?.url) {
    // Share YouTube link (embeds well on Twitter/LinkedIn)
    return videos.youtube.url;
  }
  
  // Fallback: Share canonical episode page with language param
  return `https://storybook.ai/@${company}/${project}/e/${episode}?lang=${selectedLanguage}`;
}
```

### 8.4 Share Button UX

```
[Share Episode] (Language: English)
├── 📋 Copy Link → storybook.ai/@.../e/episode?lang=en
├── 📺 Share YouTube Video → youtube.com/watch?v=abc123
├── 📘 Share Facebook Video → facebook.com/watch?v=456
├── 🐦 Twitter/X → youtube.com/watch?v=abc123
├── 💼 LinkedIn → storybook.ai/@.../e/episode?lang=en
└── 📱 QR Code → storybook.ai/@.../e/episode?lang=en
```

### 8.5 URL Structure with Language

```
# Default (uses browser/user preference)
https://storybook.ai/@company/project/e/episode

# Explicit language
https://storybook.ai/@company/project/e/episode?lang=es
https://storybook.ai/@company/project/e/episode?lang=hi
```

---

## 9. Sitemap Integration

### 9.1 Dynamic Sitemap Extension

```typescript
// apps/web/app/sitemap.ts additions

async function getPublicCompanies(): Promise<SitemapEntry[]> {
  const companies = await supabase
    .from('accounts')
    .select('slug, updated_at')
    .eq('public_profile->is_public', true);
    
  return companies.map(c => ({
    url: `${baseUrl}/@${c.slug}`,
    lastModified: c.updated_at,
    changeFrequency: 'weekly',
    priority: 0.8,
  }));
}

async function getPublicProjects(): Promise<SitemapEntry[]> {
  const projects = await supabase
    .from('projects')
    .select('public_slug, accounts!inner(slug), updated_at')
    .eq('visibility', 'public');
    
  return projects.map(p => ({
    url: `${baseUrl}/@${p.accounts.slug}/${p.public_slug}`,
    lastModified: p.updated_at,
    changeFrequency: 'weekly',
    priority: 0.7,
  }));
}

async function getPublicEpisodes(): Promise<SitemapEntry[]> {
  const episodes = await supabase
    .from('episodes')
    .select(`
      public_slug,
      updated_at,
      projects!inner(public_slug, accounts!inner(slug))
    `)
    .or('visibility.eq.public,visibility.eq.inherit')
    .eq('projects.visibility', 'public');
    
  return episodes.map(e => ({
    url: `${baseUrl}/@${e.projects.accounts.slug}/${e.projects.public_slug}/e/${e.public_slug}`,
    lastModified: e.updated_at,
    changeFrequency: 'monthly',
    priority: 0.6,
  }));
}
```

---

## 10. Page Components

### 10.1 Company Page (`/@{slug}`)

```
┌─────────────────────────────────────────────────────┐
│ [Cover Image - 1200x400]                            │
├─────────────────────────────────────────────────────┤
│ [Logo] Company Name                                 │
│ @slug · Bio text here                               │
│ [YouTube] [Twitter] [Website]                       │
├─────────────────────────────────────────────────────┤
│ Projects (12)                              [Follow] │
│ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐            │
│ │Thumb  │ │Thumb  │ │Thumb  │ │Thumb  │            │
│ │Project│ │Project│ │Project│ │Project│            │
│ │Name   │ │Name   │ │Name   │ │Name   │            │
│ │12 eps │ │8 eps  │ │24 eps │ │6 eps  │            │
│ └───────┘ └───────┘ └───────┘ └───────┘            │
└─────────────────────────────────────────────────────┘
```

### 10.2 Project Page (`/@{slug}/{project}`)

```
┌─────────────────────────────────────────────────────┐
│ [Hero: Project Cover]                    [Share]    │
│ Project Title                                       │
│ By @company-name                                    │
│ Description text...                                 │
├─────────────────────────────────────────────────────┤
│ Season 1 (12 episodes)                              │
│ ┌─────────────────────────────────────────────────┐ │
│ │ [Thumb] Ep 1: Title Here           [▶] [Share] │ │
│ │         5:30 · 2026-01-08                      │ │
│ ├─────────────────────────────────────────────────┤ │
│ │ [Thumb] Ep 2: Another Title        [▶] [Share] │ │
│ │         6:15 · 2026-01-15                      │ │
│ └─────────────────────────────────────────────────┘ │
│ Season 2 (8 episodes)                               │
│ ...                                                 │
└─────────────────────────────────────────────────────┘
```

### 10.3 Episode Page (`/@{slug}/{project}/e/{episode}`)

```
┌─────────────────────────────────────────────────────┐
│ ┌─────────────────────────────────────────────────┐ │
│ │              [VIDEO PLAYER]                     │ │
│ │      (YouTube or Facebook embed per language)   │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ Language: [🇺🇸 English ▼]          [▶ YouTube] [FB] │
│                                                     │
│ Episode Title                              [Share]  │
│ Project Name · @company · S01E01 · 5:30             │
│                                                     │
│ Description text goes here with more details...    │
│                                                     │
│ ─────────────────────────────────────────────────── │
│ More Episodes                                       │
│ [←Prev] [Ep 2] [Ep 3] [Ep 4] [Next→]               │
└─────────────────────────────────────────────────────┘
```

**Note:** Video embeds YouTube by default. If no YT for selected language, falls back to Facebook. Each language may have different channels.

---

## 11. Implementation Phases

### Phase 1: Foundation (Week 1-2)
- [ ] Database migrations for visibility, slugs, video_links
- [ ] Public page routes: `/@{slug}`, `/@{slug}/{project}`, `/@{slug}/{project}/e/{episode}`
- [ ] Basic rendering without auth

### Phase 2: SEO/OGP (Week 2-3)
- [ ] OpenGraph meta tags for all pages
- [ ] JSON-LD schemas (Organization, TVSeries, TVEpisode, VideoObject)
- [ ] Dynamic sitemap with public content
- [ ] robots.txt allowing public routes

### Phase 3: Sharing Features (Week 3-4)
- [ ] Share buttons with platform-aware logic
- [ ] Video embedding for YouTube/FB
- [ ] Copy link functionality
- [ ] Embed code generator

### Phase 4: Settings UI (Week 4-5)
- [ ] Public profile settings in Account Settings
- [ ] Project visibility toggle
- [ ] Episode visibility override
- [ ] Video link management per episode

---

## 12. Security Considerations

| Area | Requirement |
|------|-------------|
| **RLS Policies** | Public pages bypass auth but respect visibility flags |
| **Rate Limiting** | Public API endpoints have stricter limits |
| **Content Validation** | Prevent XSS in user-generated content |
| **Slug Validation** | Prevent reserved words, inappropriate content |
| **Analytics Privacy** | Anonymous view counts, no PII collection |

---

## 13. Analytics Requirements

| Event | Data Captured |
|-------|--------------|
| `public_page.view` | page_type, slug, referrer, country |
| `public_share.click` | platform, content_type, slug |
| `public_video.play` | episode_slug, platform, source_url |

---

## 14. Open Questions

1. **Custom Domains:** Should we support `series.company.com`?
2. **Monetization:** Enable tip jars or Patreon integration?
3. **Comments:** Allow public comments on episodes?
4. **Newsletter:** Email subscription on company pages?

---

## 15. Appendix

### A. Existing Codebase Assets

| File | Purpose | Reusable |
|------|---------|----------|
| `apps/web/lib/structured-data.tsx` | JSON-LD utilities | ✅ Extend |
| `apps/web/lib/root-metadata.ts` | OGP generation | ✅ Extend |
| `apps/web/app/sitemap.ts` | Sitemap generation | ✅ Extend |
| `apps/web/app/opengraph-image.tsx` | OG image generation | ✅ Template |
| `accounts.slug` | Already exists | ✅ Use as-is |
| `accounts.public_data` | JSONB field exists | ⚠️ Migrate to `public_profile` |

### B. Reference Links

- [Open Graph Protocol](https://ogp.me/)
- [schema.org TVSeries](https://schema.org/TVSeries)
- [schema.org VideoObject](https://schema.org/VideoObject)
- [Google Video SEO](https://developers.google.com/search/docs/appearance/video)
- [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/)
