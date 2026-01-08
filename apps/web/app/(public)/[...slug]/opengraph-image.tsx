import { ImageResponse } from 'next/og';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

export const runtime = 'nodejs';
export const alt = 'Company Profile';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

interface Props {
    params: Promise<{ slug: string[] }>;
}

export default async function OGImage({ params }: Props) {
    const { slug } = await params;

    // Validate @ prefix
    if (!slug[0]?.startsWith('@')) {
        return new ImageResponse(
            (
                <div
                    style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: '#1a1a2e',
                        color: '#fff',
                    }}
                >
                    <span style={{ fontSize: 48 }}>Not Found</span>
                </div>
            ),
            size
        );
    }

    const companySlug = slug[0].slice(1);
    const client = getSupabaseServerClient();

    const { data: company } = await client
        .from('accounts')
        .select('name, slug, picture_url, public_profile')
        .eq('slug', companySlug)
        .single();

    if (!company) {
        return new ImageResponse(
            (
                <div
                    style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: '#1a1a2e',
                        color: '#fff',
                    }}
                >
                    <span style={{ fontSize: 48 }}>Company Not Found</span>
                </div>
            ),
            size
        );
    }

    const profile = company.public_profile as Record<string, unknown> | null;
    const displayName = (profile?.display_name as string) || company.name;
    const bio = (profile?.bio as string) || '';
    const primaryColor = (profile?.custom_styles as Record<string, string>)?.primary_color || '#6366f1';

    // Company page OG
    if (slug.length === 1) {
        return new ImageResponse(
            (
                <div
                    style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: `linear-gradient(135deg, ${primaryColor} 0%, #1a1a2e 100%)`,
                        color: '#fff',
                        padding: 60,
                    }}
                >
                    {company.picture_url && (
                        <img
                            src={company.picture_url}
                            width={120}
                            height={120}
                            style={{
                                borderRadius: '50%',
                                marginBottom: 30,
                                border: '4px solid rgba(255,255,255,0.3)',
                            }}
                        />
                    )}
                    <span
                        style={{
                            fontSize: 64,
                            fontWeight: 'bold',
                            marginBottom: 20,
                            textAlign: 'center',
                        }}
                    >
                        {displayName}
                    </span>
                    <span
                        style={{
                            fontSize: 28,
                            opacity: 0.8,
                            textAlign: 'center',
                            maxWidth: 800,
                        }}
                    >
                        @{company.slug}
                    </span>
                    {bio && (
                        <span
                            style={{
                                fontSize: 24,
                                opacity: 0.7,
                                marginTop: 20,
                                textAlign: 'center',
                                maxWidth: 800,
                            }}
                        >
                            {bio.slice(0, 150)}
                            {bio.length > 150 ? '...' : ''}
                        </span>
                    )}
                </div>
            ),
            size
        );
    }

    // Project page OG
    if (slug.length === 2) {
        const projectSlug = slug[1]!;
        const { data: project } = await client
            .from('projects')
            .select('name, description')
            .eq('public_slug', projectSlug)
            .single();

        return new ImageResponse(
            (
                <div
                    style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        background: '#0a0a0f',
                        color: '#fff',
                    }}
                >
                    <div
                        style={{
                            width: '100%',
                            height: 400,
                            background: `linear-gradient(135deg, ${primaryColor} 0%, #1a1a2e 100%)`,
                        }}
                    />
                    <div
                        style={{
                            padding: '40px 60px',
                            display: 'flex',
                            flexDirection: 'column',
                        }}
                    >
                        <span style={{ fontSize: 48, fontWeight: 'bold' }}>
                            {project?.name || projectSlug}
                        </span>
                        <span style={{ fontSize: 24, opacity: 0.7, marginTop: 10 }}>
                            By @{company.slug}
                        </span>
                    </div>
                </div>
            ),
            size
        );
    }

    // Episode page OG
    if (slug.length === 4 && slug[2] === 'e') {
        const episodeSlug = slug[3]!;
        const { data: episode } = await client
            .from('episodes')
            .select('title, description, thumbnail_url')
            .eq('public_slug', episodeSlug)
            .single();

        return new ImageResponse(
            (
                <div
                    style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        background: '#0a0a0f',
                        color: '#fff',
                    }}
                >
                    {episode?.thumbnail_url ? (
                        <img
                            src={episode.thumbnail_url}
                            width={630}
                            height={630}
                            style={{ objectFit: 'cover' }}
                        />
                    ) : (
                        <div
                            style={{
                                width: 630,
                                height: 630,
                                background: `linear-gradient(135deg, ${primaryColor} 0%, #1a1a2e 100%)`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            <span style={{ fontSize: 120, opacity: 0.3 }}>▶</span>
                        </div>
                    )}
                    <div
                        style={{
                            width: 570,
                            padding: 50,
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'center',
                        }}
                    >
                        <span style={{ fontSize: 20, opacity: 0.6, marginBottom: 15 }}>
                            Episode
                        </span>
                        <span
                            style={{
                                fontSize: 40,
                                fontWeight: 'bold',
                                marginBottom: 20,
                                lineHeight: 1.2,
                            }}
                        >
                            {episode?.title || episodeSlug}
                        </span>
                        <span
                            style={{
                                fontSize: 22,
                                opacity: 0.7,
                                lineHeight: 1.4,
                            }}
                        >
                            {(episode?.description || '').slice(0, 200)}
                            {(episode?.description || '').length > 200 ? '...' : ''}
                        </span>
                        <span
                            style={{
                                fontSize: 18,
                                opacity: 0.5,
                                marginTop: 'auto',
                            }}
                        >
                            @{company.slug}
                        </span>
                    </div>
                </div>
            ),
            size
        );
    }

    // Fallback
    return new ImageResponse(
        (
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#1a1a2e',
                    color: '#fff',
                }}
            >
                <span style={{ fontSize: 48 }}>StoryBook</span>
            </div>
        ),
        size
    );
}
