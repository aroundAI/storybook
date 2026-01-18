import { Metadata } from 'next';

import { notFound } from 'next/navigation';

import { CompanyPage } from '@kit/public-sharing/components/company-page';
import { EpisodePage } from '@kit/public-sharing/components/episode-page';
import { ProjectPage } from '@kit/public-sharing/components/project-page';
import {
  generateCompanyMetadata,
  generateEpisodeMetadata,
  generateProjectMetadata,
} from '@kit/public-sharing/lib/metadata';
import {
  getOrganizationSchema,
  getTVEpisodeSchema,
  getTVSeriesSchema,
} from '@kit/public-sharing/lib/structured-data';
import {
  getEpisodePlatformUrls,
  getPublicCompany,
  getPublicEpisode,
  getPublicEpisodes,
  getPublicProject,
  getPublicProjects,
} from '@kit/public-sharing/server/public-queries';

interface PageProps {
  params: Promise<{ slug: string[] }>;
  searchParams: Promise<{ lang?: string }>;
}

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://storybook.com'; // Adjust fallback

export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const { lang = 'en' } = await searchParams;

  // Decode URL-encoded slugs (e.g., %40storybook -> @storybook)
  const decodedSlug = slug.map((s) => decodeURIComponent(s));

  if (
    !decodedSlug ||
    decodedSlug.length === 0 ||
    !decodedSlug[0] ||
    !decodedSlug[0].startsWith('@')
  )
    return {};

  const companySlug = decodedSlug[0].substring(1);

  // 1. Company Page: /@company
  if (decodedSlug.length === 1) {
    const company = await getPublicCompany(companySlug);
    if (!company) return {};
    return generateCompanyMetadata(company);
  }

  // 2. Project Page: /@company/project
  if (decodedSlug.length === 2) {
    const company = await getPublicCompany(companySlug);
    if (!company) return {};
    const projectSlug = decodedSlug[1]!;
    const project = await getPublicProject(company.id, projectSlug);
    if (!project) return {};
    return generateProjectMetadata(project);
  }

  // 3. Episode Page: /@company/project/e/episode
  if (decodedSlug.length === 4 && decodedSlug[2] === 'e') {
    const company = await getPublicCompany(companySlug);
    if (!company) return {};
    const projectSlug = decodedSlug[1]!;
    const project = await getPublicProject(company.id, projectSlug);
    if (!project) return {};
    const episodeSlug = decodedSlug[3]!;
    const episode = await getPublicEpisode(project.id, episodeSlug);
    if (!episode) return {};
    if (typeof lang !== 'string') return {};
    return generateEpisodeMetadata(episode, lang);
  }

  return {};
}

export default async function PublicPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { lang = 'en' } = await searchParams;

  // Decode URL-encoded slugs (e.g., %40storybook -> @storybook)
  const decodedSlug = slug.map((s) => decodeURIComponent(s));

  if (
    !decodedSlug ||
    decodedSlug.length === 0 ||
    !decodedSlug[0] ||
    !decodedSlug[0].startsWith('@')
  ) {
    return notFound();
  }

  const companySlug = decodedSlug[0].substring(1);
  const company = await getPublicCompany(companySlug);

  if (!company) {
    return notFound();
  }

  let structuredData = null;

  // 1. Company Page
  if (decodedSlug.length === 1) {
    const projects = await getPublicProjects(company.id);
    structuredData = getOrganizationSchema(company, BASE_URL);

    return (
      <>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        <CompanyPage company={company} projects={projects} />
      </>
    );
  }

  // 2. Project Page
  if (decodedSlug.length === 2) {
    const projectSlug = decodedSlug[1]!;
    const project = await getPublicProject(company.id, projectSlug);
    if (!project) return notFound();

    const episodes = await getPublicEpisodes(project.id);
    structuredData = getTVSeriesSchema(project, BASE_URL);

    return (
      <>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        <ProjectPage project={project} episodes={episodes} baseUrl={BASE_URL} />
      </>
    );
  }

  // 3. Episode Page
  if (decodedSlug.length === 4 && decodedSlug[2] === 'e') {
    const projectSlug = decodedSlug[1]!;
    const project = await getPublicProject(company.id, projectSlug);
    if (!project) return notFound();

    const episodeSlug = decodedSlug[3]!;
    const episode = await getPublicEpisode(project.id, episodeSlug);
    if (!episode) return notFound();

    // Get YouTube/Facebook URLs from publishes table
    const platformUrls = await getEpisodePlatformUrls(episode.id);

    if (typeof lang !== 'string') return notFound();
    structuredData = getTVEpisodeSchema(episode, lang, BASE_URL);

    return (
      <>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        <EpisodePage
          episode={episode}
          platformUrls={platformUrls}
          language={lang}
          baseUrl={BASE_URL}
        />
      </>
    );
  }

  return notFound();
}
