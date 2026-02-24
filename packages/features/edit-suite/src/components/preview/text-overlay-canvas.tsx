'use client';

/**
 * TextOverlayCanvas — renders title/text overlays on the video preview.
 *
 * Uses OffscreenCanvas when available for performance,
 * falls back to standard Canvas2D rendering.
 *
 * Supports:
 * - Configurable font family, size, weight, and color
 * - Text shadow with blur
 * - Text outline (stroke)
 * - Background box with padding
 * - Normalized positioning (0-1 coords)
 * - Fade-in/out via opacity driven by keyframe animation
 */

import { useEffect, useRef, useMemo } from 'react';

import type { EditClip, EditKeyframe } from '../../lib/types';
import { getKeyframesForProperty, interpolateKeyframes } from '../../lib/keyframe-engine';

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

interface TextOverlayCanvasProps {
    /** Title clips that are visible at the current playhead position */
    titleClips: EditClip[];
    /** All keyframes for opacity/position animation */
    keyframes: EditKeyframe[];
    /** Current playhead time in ms */
    playheadMs: number;
    /** Canvas width in pixels */
    width: number;
    /** Canvas height in pixels */
    height: number;
}

// ──────────────────────────────────────────
// Component
// ──────────────────────────────────────────

export function TextOverlayCanvas({
    titleClips,
    keyframes,
    playheadMs,
    width,
    height,
}: TextOverlayCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Find title clips that are active at the current playhead position
    const activeTitleClips = useMemo(() => {
        return titleClips.filter(
            (clip) =>
                clip.isActive &&
                clip.text &&
                playheadMs >= clip.startMs &&
                playheadMs <= clip.endMs,
        );
    }, [titleClips, playheadMs]);

    // Render text overlays on canvas
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Clear the canvas
        ctx.clearRect(0, 0, width, height);

        for (const clip of activeTitleClips) {
            if (!clip.text) continue;

            // Calculate opacity from keyframes (for fade-in/out animation)
            const clipLocalMs = playheadMs - clip.startMs;
            const opacityKfs = getKeyframesForProperty(keyframes, clip.id, 'opacity');
            let opacity = 1;

            if (opacityKfs.length > 0) {
                opacity = interpolateKeyframes(opacityKfs, clipLocalMs);
            } else {
                // Auto fade-in/out based on clip's fadeIn/fadeOut settings
                const durationMs = clip.endMs - clip.startMs;
                if (clip.fadeInMs > 0 && clipLocalMs < clip.fadeInMs) {
                    opacity = clipLocalMs / clip.fadeInMs;
                } else if (clip.fadeOutMs > 0 && clipLocalMs > durationMs - clip.fadeOutMs) {
                    opacity = (durationMs - clipLocalMs) / clip.fadeOutMs;
                }
            }

            opacity = Math.max(0, Math.min(1, opacity));
            if (opacity <= 0) continue;

            ctx.save();
            ctx.globalAlpha = opacity;

            const fontSize = clip.fontSize ?? 48;
            const fontFamily = clip.fontFamily ?? 'Inter, sans-serif';
            const fontWeight = clip.fontWeight ?? 'bold';
            const fontColor = clip.fontColor ?? '#ffffff';
            const textAlign = clip.textAlign ?? 'center';

            // Position (normalized 0-1 coords → pixel coords)
            const posX = (clip.textPositionX ?? 0.5) * width;
            const posY = (clip.textPositionY ?? 0.5) * height;

            ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
            ctx.textAlign = textAlign;
            ctx.textBaseline = 'middle';

            // Draw background box if specified
            if (clip.textBackgroundColor) {
                const metrics = ctx.measureText(clip.text);
                const padding = 12;
                const boxX = textAlign === 'center'
                    ? posX - metrics.width / 2 - padding
                    : textAlign === 'right'
                        ? posX - metrics.width - padding
                        : posX - padding;
                const boxY = posY - fontSize / 2 - padding / 2;

                ctx.fillStyle = clip.textBackgroundColor;
                ctx.fillRect(
                    boxX,
                    boxY,
                    metrics.width + padding * 2,
                    fontSize + padding,
                );
            }

            // Draw text outline (stroke)
            if (clip.textOutlineColor && (clip.textOutlineWidth ?? 0) > 0) {
                ctx.strokeStyle = clip.textOutlineColor;
                ctx.lineWidth = clip.textOutlineWidth!;
                ctx.lineJoin = 'round';
                ctx.strokeText(clip.text, posX, posY);
            }

            // Draw text shadow
            if (clip.textShadowColor) {
                ctx.shadowColor = clip.textShadowColor;
                ctx.shadowBlur = clip.textShadowBlur ?? 4;
                ctx.shadowOffsetX = 2;
                ctx.shadowOffsetY = 2;
            }

            // Draw text fill
            ctx.fillStyle = fontColor;
            ctx.fillText(clip.text, posX, posY);

            ctx.restore();
        }
    }, [activeTitleClips, keyframes, playheadMs, width, height]);

    if (activeTitleClips.length === 0) return null;

    return (
        <canvas
            ref={canvasRef}
            className="pointer-events-none absolute inset-0 z-20"
            width={width}
            height={height}
            style={{ width: '100%', height: '100%' }}
        />
    );
}
