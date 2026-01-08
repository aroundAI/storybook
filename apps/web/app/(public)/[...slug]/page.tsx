import { notFound } from 'next/navigation';
import { Metadata } from 'next';

import {
    getPublicCompany,
    getPublicProject,
    getPublicEpisode,
    getPublicProjects,
    getPublicEpisodes,
} from '@kit/public-sharing/server/public-queries';

import {
    generateCompanyMetadata,
    generateProjectMetadata,
    generateEpisodeMetadata,
} from '@kit/public-sharing/lib/metadata';

import {
    getOrganizationSchema,
    getTVSeriesSchema,
    getTVEpisodeSchema,
} from '@kit/public-sharing/lib/structured-data';

import { CompanyPage } from '@kit/public-sharing/components/company-page';
import { ProjectPage } from '@kit/public-sharing/components/project-page';
import { EpisodePage } from '@kit/public-sharing/components/episode-page';

interface PageProps {
    params: Promise<{ slug: string[] }>;
    searchParams: Promise<{ lang?: string }>;
}

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://storybook.com'; // Adjust fallback

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
    const { slug } = await params;
    const { lang = 'en' } = await searchParams;

    if (!slug || slug.length === 0 || !slug[0] || !slug[0].startsWith('@')) return {};

    const companySlug = slug[0].substring(1);

    // 1. Company Page: /@company
    if (slug.length === 1) {
        const company = await getPublicCompany(companySlug);
        if (!company) return {};
        return generateCompanyMetadata(company);
    }

    // 2. Project Page: /@company/project
    if (slug.length === 2) {
        const company = await getPublicCompany(companySlug);
        if (!company) return {};
        const projectSlug = slug[1]!;
        const project = await getPublicProject(company.id, projectSlug);
        if (!project) return {};
        return generateProjectMetadata(project);
    }

    // 3. Episode Page: /@company/project/e/episode
    if (slug.length === 4 && slug[2] === 'e') {
        const company = await getPublicCompany(companySlug);
        if (!company) return {};
        const projectSlug = slug[1]!;
        const project = await getPublicProject(company.id, projectSlug);
        if (!project) return {};
        const episodeSlug = slug[3]!;
        const episode = await getPublicEpisode(project.id, episodeSlug);
        if (!episode) return {};
        if (typeof lang !== 'string') return {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return generateEpisodeMetadata(episode as any, lang);
    }

    return {};
}

export default async function PublicPage({ params, searchParams }: PageProps) {
    const { slug } = await params;
    const { lang = 'en' } = await searchParams;

    if (!slug || slug.length === 0 || !slug[0] || !slug[0].startsWith('@')) {
        return notFound();
    }

    const companySlug = slug[0].substring(1);
    const company = await getPublicCompany(companySlug);

    if (!company) {
        return notFound();
    }

    let structuredData = null;

    // 1. Company Page
    if (slug.length === 1) {
        const projects = await getPublicProjects(company.id);
        structuredData = getOrganizationSchema(company, BASE_URL);

        return (
            <>
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
                />
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <CompanyPage company={company} projects={projects as any} />
            </>
        );
    }

    // 2. Project Page
    if (slug.length === 2) {
        const projectSlug = slug[1]!;
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
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <ProjectPage project={project} episodes={episodes as any} baseUrl={BASE_URL} />
            </>
        );
    }

    // 3. Episode Page
    if (slug.length === 4 && slug[2] === 'e') {
        const projectSlug = slug[1]!;
        const project = await getPublicProject(company.id, projectSlug);
        if (!project) return notFound();

        const episodeSlug = slug[3]!;
        const episode = await getPublicEpisode(project.id, episodeSlug);
        if (!episode) return notFound();

        if (typeof lang !== 'string') return notFound();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        structuredData = getTVEpisodeSchema(episode as any, lang, BASE_URL);

        return (
            <>
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
                />
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <EpisodePage episode={episode as any} language={lang} baseUrl={BASE_URL} />
            </>
        );
    }

    return notFound();
}
