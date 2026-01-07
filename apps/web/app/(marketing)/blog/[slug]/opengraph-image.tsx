import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Blog Post';
export const size = {
    width: 1200,
    height: 630,
};
export const contentType = 'image/png';

interface Props {
    params: Promise<{ slug: string }>;
}

/**
 * Dynamic OpenGraph image for blog posts
 * Generates a branded image with the post title
 */
export default async function Image({ params }: Props) {
    const { slug } = await params;

    // Convert slug to title (basic conversion)
    const title = slug
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

    return new ImageResponse(
        (
            <div
                style={{
                    height: '100%',
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
                    fontFamily: 'system-ui, sans-serif',
                    padding: '60px',
                }}
            >
                {/* Decorative gradient */}
                <div
                    style={{
                        position: 'absolute',
                        top: '0',
                        right: '0',
                        width: '600px',
                        height: '600px',
                        background: 'radial-gradient(circle, rgba(99,102,241,0.2) 0%, transparent 60%)',
                    }}
                />

                {/* Blog label */}
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        marginBottom: '40px',
                    }}
                >
                    <div
                        style={{
                            padding: '8px 16px',
                            borderRadius: '8px',
                            background: 'rgba(99, 102, 241, 0.2)',
                            color: '#818cf8',
                            fontSize: '16px',
                            fontWeight: 600,
                        }}
                    >
                        BLOG
                    </div>
                </div>

                {/* Title */}
                <div
                    style={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                    }}
                >
                    <h1
                        style={{
                            fontSize: '64px',
                            fontWeight: 700,
                            color: 'white',
                            lineHeight: 1.2,
                            letterSpacing: '-0.02em',
                            maxWidth: '900px',
                        }}
                    >
                        {title}
                    </h1>
                </div>

                {/* Footer */}
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                    }}
                >
                    {/* Logo */}
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                        }}
                    >
                        <div
                            style={{
                                width: '40px',
                                height: '40px',
                                borderRadius: '10px',
                                background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            <svg
                                width="22"
                                height="22"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="white"
                                strokeWidth="2"
                            >
                                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                                <path d="M2 17l10 5 10-5" />
                                <path d="M2 12l10 5 10-5" />
                            </svg>
                        </div>
                        <span
                            style={{
                                fontSize: '24px',
                                fontWeight: 600,
                                color: 'white',
                            }}
                        >
                            StoryBook
                        </span>
                    </div>

                    {/* URL */}
                    <span
                        style={{
                            color: 'rgba(255, 255, 255, 0.5)',
                            fontSize: '18px',
                        }}
                    >
                        storybook.digital/blog
                    </span>
                </div>
            </div>
        ),
        {
            ...size,
        },
    );
}
