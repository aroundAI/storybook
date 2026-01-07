import { ImageResponse } from 'next/og';

import appConfig from '~/config/app.config';

// Note: Edge runtime removed for OpenNext/AWS Lambda compatibility
export const alt = 'StoryBook - AI-Powered Film Studio';
export const size = {
    width: 1200,
    height: 630,
};
export const contentType = 'image/png';

/**
 * Default OpenGraph image for homepage and general pages
 * This creates a dynamic, branded image for social sharing
 */
export default async function Image() {
    return new ImageResponse(
        (
            <div
                style={{
                    height: '100%',
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
                    fontFamily: 'system-ui, sans-serif',
                }}
            >
                {/* Decorative gradient orbs */}
                <div
                    style={{
                        position: 'absolute',
                        top: '-100px',
                        right: '-100px',
                        width: '400px',
                        height: '400px',
                        borderRadius: '50%',
                        background: 'radial-gradient(circle, rgba(99,102,241,0.3) 0%, transparent 70%)',
                    }}
                />
                <div
                    style={{
                        position: 'absolute',
                        bottom: '-150px',
                        left: '-100px',
                        width: '500px',
                        height: '500px',
                        borderRadius: '50%',
                        background: 'radial-gradient(circle, rgba(139,92,246,0.2) 0%, transparent 70%)',
                    }}
                />

                {/* Main content */}
                <div
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        textAlign: 'center',
                        padding: '60px',
                    }}
                >
                    {/* Logo/Brand */}
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '16px',
                            marginBottom: '24px',
                        }}
                    >
                        <div
                            style={{
                                width: '64px',
                                height: '64px',
                                borderRadius: '16px',
                                background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            <svg
                                width="36"
                                height="36"
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
                                fontSize: '48px',
                                fontWeight: 700,
                                color: 'white',
                                letterSpacing: '-0.02em',
                            }}
                        >
                            {appConfig.name}
                        </span>
                    </div>

                    {/* Tagline */}
                    <p
                        style={{
                            fontSize: '32px',
                            fontWeight: 600,
                            color: 'white',
                            marginBottom: '16px',
                            maxWidth: '800px',
                        }}
                    >
                        AI-Powered Film Studio
                    </p>

                    {/* Description */}
                    <p
                        style={{
                            fontSize: '20px',
                            color: 'rgba(255, 255, 255, 0.7)',
                            maxWidth: '700px',
                            lineHeight: 1.5,
                        }}
                    >
                        Create professional video content with AI. Generate stories, screenplays, visuals, and audio.
                    </p>

                    {/* CTA */}
                    <div
                        style={{
                            marginTop: '40px',
                            padding: '16px 32px',
                            borderRadius: '12px',
                            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                            color: 'white',
                            fontSize: '18px',
                            fontWeight: 600,
                        }}
                    >
                        Start Creating Free →
                    </div>
                </div>

                {/* URL at bottom */}
                <div
                    style={{
                        position: 'absolute',
                        bottom: '30px',
                        color: 'rgba(255, 255, 255, 0.5)',
                        fontSize: '16px',
                    }}
                >
                    storybook.digital
                </div>
            </div>
        ),
        {
            ...size,
        },
    );
}
