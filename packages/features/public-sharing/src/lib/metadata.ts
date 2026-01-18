import { Metadata } from 'next';
import { PublicAccount, PublicProject, PublicEpisode } from '../server/public-queries';

type SeoMetadata = {
    title?: string;
    description?: string;
    keywords?: string[];
    image?: string;
};

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

export function generateCompanyMetadata(company: PublicAccount): Metadata {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const profile = company.public_profile as any;
    const title = profile?.display_name || company.name;
    const description = profile?.bio || `Public profile for ${company.name}`;

    return {
        title,
        description,
        openGraph: {
            type: 'profile',
            title,
            description,
            images: company.picture_url ? [company.picture_url] : [],
        },
        twitter: {
            card: 'summary_large_image',
            title,
            description,
            images: company.picture_url ? [company.picture_url] : [],
        },
    };
}

export function generateProjectMetadata(project: PublicProject): Metadata {
    const _accountSlug = project.account.slug;
    const seo = (project.seo_metadata || {}) as SeoMetadata;

    const title = seo.title || `${project.name} | ${project.account.name}`;
    const description = seo.description || project.description || `Project by ${project.account.name}`;

    const metadata: Metadata = {
        title,
        description,
        keywords: seo.keywords,
        openGraph: {
            type: 'website',
            title,
            description,
            siteName: project.account.name,
        },
        twitter: {
            card: 'summary_large_image',
            title,
            description,
        },
    };

    if (project.visibility === 'unlisted') {
        metadata.robots = {
            index: false,
            follow: false,
        };
    }

    return metadata;
}

export function generateEpisodeMetadata(
    episode: PublicEpisode,
    language: string
): Metadata {
    const seo = (episode.seo_metadata || {}) as SeoMetadata;
    const videoData = (episode.localized_videos as Record<string, LocalizedVideoData>)[language];

    const title = seo.title || `${episode.title} | ${episode.project.name}`;
    const description = seo.description || episode.description || `Episode from ${episode.project.name}`;
    const images = episode.thumbnail_url ? [episode.thumbnail_url] : [];

    const metadata: Metadata = {
        title,
        description,
        openGraph: {
            type: 'video.episode',
            title,
            description,
            images,
            // We can try adding video OpenGraph tags if we have a direct video URL, 
            // but typical YT/FB links are players. 
            // 'video.episode' mostly just needs metadata.
        },
        twitter: {
            card: 'player', // Use player card if we have video
            title,
            description,
            images,
        },
    };

    if (videoData) {
        const videoUrl = videoData.youtube?.url || videoData.facebook?.url;
        if (videoUrl) {
            // Just linking the video URL isn't enough for twitter player card without correct meta tags,
            // but often platforms will unfurl the YouTube link if we provide it.
            // However, we are the sharing page.
            // For 'player' card, we need `twitter:player` meta tags which Next.js supports via `other`.
            // But for simplicity we might stick to summary_large_image unless we implement full player support.
            // Let's stick to summary_large_image for now as implementing player card requires whitelisting and complex validation.
            metadata.twitter = {
                ...metadata.twitter,
                card: 'summary_large_image',
            };
        }
    }

    if (episode.visibility === 'unlisted' || episode.project.visibility === 'unlisted') {
        metadata.robots = {
            index: false,
            follow: false,
        };
    }

    return metadata;
}
