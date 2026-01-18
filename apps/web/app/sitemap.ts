import { MetadataRoute } from 'next';

import { createCmsClient } from '@kit/cms';
import { getLogger } from '@kit/shared/logger';

import appConfig from '~/config/app.config';
import { getSitemapData } from '@kit/public-sharing/server/public-queries';

/**
 * Dynamic sitemap generation for SEO
 * Includes all public pages: marketing, blog, docs, legal
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const baseUrl = appConfig.url;
    const now = new Date();

    // Static pages with priorities
    const staticPages: MetadataRoute.Sitemap = [
        {
            url: baseUrl,
            lastModified: now,
            changeFrequency: 'weekly',
            priority: 1.0,
        },
        {
            url: `${baseUrl}/blog`,
            lastModified: now,
            changeFrequency: 'daily',
            priority: 0.8,
        },
        {
            url: `${baseUrl}/docs`,
            lastModified: now,
            changeFrequency: 'weekly',
            priority: 0.7,
        },
        {
            url: `${baseUrl}/faq`,
            lastModified: now,
            changeFrequency: 'monthly',
            priority: 0.5,
        },
        {
            url: `${baseUrl}/contact`,
            lastModified: now,
            changeFrequency: 'monthly',
            priority: 0.5,
        },
        // Legal pages
        {
            url: `${baseUrl}/terms-of-service`,
            lastModified: now,
            changeFrequency: 'monthly',
            priority: 0.3,
        },
        {
            url: `${baseUrl}/privacy-policy`,
            lastModified: now,
            changeFrequency: 'monthly',
            priority: 0.3,
        },
        {
            url: `${baseUrl}/cookie-policy`,
            lastModified: now,
            changeFrequency: 'monthly',
            priority: 0.3,
        },
    ];

    // Dynamic blog posts
    const blogPosts = await getBlogPostUrls(baseUrl);

    // Dynamic documentation pages
    const docPages = await getDocumentationUrls(baseUrl);

    // Public Sharing Pages
    const { accounts, projects, episodes } = await getSitemapData();
    const sharingPages: MetadataRoute.Sitemap = [];

    // Companies
    if (accounts) {
        accounts.forEach((acc: { slug: string | null; updated_at: string | null }) => {
            if (!acc.slug) return;
            sharingPages.push({
                url: `${baseUrl}/@${acc.slug}`,
                lastModified: acc.updated_at ? new Date(acc.updated_at) : now,
                changeFrequency: 'weekly',
                priority: 0.8,
            });
        });
    }

    // Projects
    if (projects) {
        projects.forEach((proj: { account?: { slug: string | null }; public_slug?: string | null; updated_at: string | null }) => {
            if (!proj.account || !proj.account.slug || !proj.public_slug) return;
            sharingPages.push({
                url: `${baseUrl}/@${proj.account.slug}/${proj.public_slug}`,
                lastModified: proj.updated_at ? new Date(proj.updated_at) : now,
                changeFrequency: 'weekly',
                priority: 0.7,
            });
        });
    }

    // Episodes
    if (episodes) {
        episodes.forEach((ep: { project?: { account?: { slug: string | null }; public_slug?: string | null }; public_slug?: string | null; updated_at: string }) => {
            if (!ep.project || !ep.project.account || !ep.project.account.slug || !ep.project.public_slug || !ep.public_slug) return;
            sharingPages.push({
                url: `${baseUrl}/@${ep.project.account.slug}/${ep.project.public_slug}/e/${ep.public_slug}`,
                lastModified: ep.updated_at ? new Date(ep.updated_at) : now,
                changeFrequency: 'weekly',
                priority: 0.6,
            });
        });
    }

    return [...staticPages, ...blogPosts, ...docPages, ...sharingPages];
}

/**
 * Get all blog post URLs for sitemap
 */
async function getBlogPostUrls(
    baseUrl: string,
): Promise<MetadataRoute.Sitemap> {
    const logger = await getLogger();

    try {
        const client = await createCmsClient();
        const { items: posts } = await client.getContentItems({
            collection: 'posts',
            limit: 1000, // Get all posts
            offset: 0,
            content: false,
            sortBy: 'publishedAt',
            sortDirection: 'desc',
        });

        return posts.map((post) => ({
            url: `${baseUrl}/blog/${post.slug}`,
            lastModified: post.publishedAt ? new Date(post.publishedAt) : new Date(),
            changeFrequency: 'weekly' as const,
            priority: 0.7,
        }));
    } catch (error) {
        logger.warn({ error }, '[Sitemap] Could not fetch blog posts');
        return [];
    }
}

/**
 * Get all documentation URLs for sitemap
 */
async function getDocumentationUrls(
    baseUrl: string,
): Promise<MetadataRoute.Sitemap> {
    const logger = await getLogger();

    try {
        const client = await createCmsClient();
        const { items: docs } = await client.getContentItems({
            collection: 'documentation',
            limit: 1000, // Get all docs
            offset: 0,
            content: false,
        });

        return docs.map((doc) => ({
            url: `${baseUrl}/docs/${doc.slug}`,
            lastModified: new Date(),
            changeFrequency: 'weekly' as const,
            priority: 0.6,
        }));
    } catch (error) {
        logger.warn({ error }, '[Sitemap] Could not fetch documentation pages');
        return [];
    }
}
