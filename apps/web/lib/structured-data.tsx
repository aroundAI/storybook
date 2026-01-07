import appConfig from '~/config/app.config';

// JSON-LD types (inline to avoid external dependencies)
type JsonLdContext = 'https://schema.org';

interface WithContext<T> {
    '@context': JsonLdContext;
    '@type': string;
    [key: string]: unknown;
}

/**
 * Organization schema for global use
 * Helps Google understand the business entity
 */
export function getOrganizationSchema(): WithContext<unknown> {
    return {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: appConfig.name,
        url: appConfig.url,
        logo: `${appConfig.url}/images/logo-dark.png`,
        description: appConfig.description,
        sameAs: [
            // Add social media URLs when available
            // 'https://twitter.com/storybook',
            // 'https://linkedin.com/company/storybook',
        ],
    };
}

/**
 * WebSite schema with SearchAction for sitelinks search box
 */
export function getWebSiteSchema(): WithContext<unknown> {
    return {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: appConfig.name,
        url: appConfig.url,
        description: appConfig.description,
        potentialAction: {
            '@type': 'SearchAction',
            target: {
                '@type': 'EntryPoint',
                urlTemplate: `${appConfig.url}/search?q={search_term_string}`,
            },
            'query-input': 'required name=search_term_string',
        },
    };
}

/**
 * SoftwareApplication schema for the product
 * Shows rich snippets with ratings in search results
 */
export function getSoftwareApplicationSchema(): WithContext<unknown> {
    return {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: appConfig.name,
        applicationCategory: 'MultimediaApplication',
        operatingSystem: 'Web',
        offers: {
            '@type': 'Offer',
            price: '0',
            priceCurrency: 'USD',
            description: 'Free tier available',
        },
        description: appConfig.description,
        url: appConfig.url,
    };
}

/**
 * WebPage schema for individual pages
 */
export function getWebPageSchema(options: {
    title: string;
    description: string;
    url: string;
    datePublished?: string;
    dateModified?: string;
}): WithContext<unknown> {
    return {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: options.title,
        description: options.description,
        url: options.url,
        isPartOf: {
            '@type': 'WebSite',
            name: appConfig.name,
            url: appConfig.url,
        },
        ...(options.datePublished && { datePublished: options.datePublished }),
        ...(options.dateModified && { dateModified: options.dateModified }),
    };
}

/**
 * Article schema for blog posts
 */
export function getArticleSchema(options: {
    title: string;
    description: string;
    url: string;
    imageUrl?: string;
    datePublished: string;
    dateModified?: string;
    authorName?: string;
}): WithContext<unknown> {
    return {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: options.title,
        description: options.description,
        url: options.url,
        image: options.imageUrl ?? `${appConfig.url}/images/og/blog-default.png`,
        datePublished: options.datePublished,
        dateModified: options.dateModified ?? options.datePublished,
        author: {
            '@type': 'Person',
            name: options.authorName ?? 'StoryBook Team',
        },
        publisher: {
            '@type': 'Organization',
            name: appConfig.name,
            logo: {
                '@type': 'ImageObject',
                url: `${appConfig.url}/images/logo-dark.png`,
            },
        },
        mainEntityOfPage: {
            '@type': 'WebPage',
            '@id': options.url,
        },
    };
}

/**
 * FAQPage schema for FAQ pages
 * Enables FAQ rich snippets in search results
 */
export function getFAQPageSchema(
    faqs: Array<{ question: string; answer: string }>,
): WithContext<unknown> {
    return {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faqs.map((faq) => ({
            '@type': 'Question',
            name: faq.question,
            acceptedAnswer: {
                '@type': 'Answer',
                text: faq.answer,
            },
        })),
    };
}

/**
 * BreadcrumbList schema for navigation
 */
export function getBreadcrumbSchema(
    items: Array<{ name: string; url: string }>,
): WithContext<unknown> {
    return {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: items.map((item, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: item.name,
            item: item.url,
        })),
    };
}

/**
 * Component to render JSON-LD in head
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
    return (
        <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
        />
    );
}
