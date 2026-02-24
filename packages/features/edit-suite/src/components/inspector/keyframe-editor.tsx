'use client';

/**
 * KeyframeEditor — SVG-based curve editor for keyframe animation.
 *
 * Renders in the Inspector panel for the selected clip.
 * Features:
 *   - Property selector dropdown
 *   - SVG canvas with draggable ◆ diamond markers
 *   - Curve visualization between keyframes using easing function
 *   - Double-click to add keyframe
 *   - Easing preset buttons
 */

import { useState, useMemo, useCallback, useRef, type Dispatch } from 'react';

import type { EditClip, EditKeyframe } from '../../lib/types';
import type { KeyframeProperty, KeyframeEasing } from '../../lib/schemas';
import type { EditAction } from '../../state/types';
import { interpolateKeyframes, KEYFRAME_DEFAULTS } from '../../lib/keyframe-engine';

// ──────────────────────────────────────────
// Constants
// ──────────────────────────────────────────

const SVG_WIDTH = 280;
const SVG_HEIGHT = 160;
const PADDING = 20;
const DIAMOND_SIZE = 6;

const PROPERTY_OPTIONS: { value: KeyframeProperty; label: string; color: string }[] = [
    { value: 'volume', label: 'Volume', color: '#10b981' },
    { value: 'opacity', label: 'Opacity', color: '#8b5cf6' },
    { value: 'position_x', label: 'Position X', color: '#3b82f6' },
    { value: 'position_y', label: 'Position Y', color: '#06b6d4' },
    { value: 'scale', label: 'Scale', color: '#f59e0b' },
    { value: 'rotation', label: 'Rotation', color: '#ef4444' },
];

const EASING_PRESETS: { value: KeyframeEasing; label: string }[] = [
    { value: 'linear', label: 'Linear' },
    { value: 'ease_in', label: 'Ease In' },
    { value: 'ease_out', label: 'Ease Out' },
    { value: 'ease_in_out', label: 'Ease I/O' },
    { value: 'hold', label: 'Hold' },
];

/** Value ranges per property for Y-axis mapping */
const PROPERTY_RANGES: Record<KeyframeProperty, { min: number; max: number }> = {
    volume: { min: 0, max: 2 },
    opacity: { min: 0, max: 1 },
    position_x: { min: -500, max: 500 },
    position_y: { min: -500, max: 500 },
    scale: { min: 0, max: 3 },
    rotation: { min: -360, max: 360 },
};

// ──────────────────────────────────────────
// Component
// ──────────────────────────────────────────

interface KeyframeEditorProps {
    clip: EditClip;
    keyframes: EditKeyframe[];
    dispatch: Dispatch<EditAction>;
}

export function KeyframeEditor({ clip, keyframes, dispatch }: KeyframeEditorProps) {
    const [selectedProperty, setSelectedProperty] = useState<KeyframeProperty>('volume');
    const [dragIdx, setDragIdx] = useState<number | null>(null);
    const svgRef = useRef<SVGSVGElement>(null);

    const propOption = PROPERTY_OPTIONS.find((p) => p.value === selectedProperty)!;
    const range = PROPERTY_RANGES[selectedProperty];
    const clipDurationMs = clip.outPointMs - clip.inPointMs;

    // Filter and sort keyframes for this property
    const propKeyframes = useMemo(
        () =>
            keyframes
                .filter((kf) => kf.clipId === clip.id && kf.property === selectedProperty)
                .sort((a, b) => a.offsetMs - b.offsetMs),
        [keyframes, clip.id, selectedProperty],
    );

    // Coordinate conversions
    const graphW = SVG_WIDTH - PADDING * 2;
    const graphH = SVG_HEIGHT - PADDING * 2;

    const toSvgX = useCallback(
        (ms: number) => PADDING + (ms / clipDurationMs) * graphW,
        [clipDurationMs, graphW],
    );
    const toSvgY = useCallback(
        (value: number) => PADDING + graphH - ((value - range.min) / (range.max - range.min)) * graphH,
        [range, graphH],
    );
    const fromSvgX = useCallback(
        (px: number) => Math.max(0, Math.min(clipDurationMs, ((px - PADDING) / graphW) * clipDurationMs)),
        [clipDurationMs, graphW],
    );
    const fromSvgY = useCallback(
        (py: number) => {
            const fraction = 1 - (py - PADDING) / graphH;
            return range.min + fraction * (range.max - range.min);
        },
        [range, graphH],
    );

    // Generate curve path by sampling the interpolation function
    const curvePath = useMemo(() => {
        if (propKeyframes.length === 0) {
            const defaultVal = KEYFRAME_DEFAULTS[selectedProperty];
            const y = toSvgY(defaultVal);
            return `M ${PADDING} ${y} L ${SVG_WIDTH - PADDING} ${y}`;
        }

        const steps = 100;
        const points: string[] = [];

        for (let i = 0; i <= steps; i++) {
            const ms = (i / steps) * clipDurationMs;
            const value = interpolateKeyframes(propKeyframes, ms);
            const x = toSvgX(ms);
            const y = toSvgY(value);
            points.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
        }

        return points.join(' ');
    }, [propKeyframes, clipDurationMs, selectedProperty, toSvgX, toSvgY]);

    // ── Interactions ──

    const handleDoubleClick = useCallback(
        (e: React.MouseEvent<SVGSVGElement>) => {
            const svg = svgRef.current;
            if (!svg) return;

            const rect = svg.getBoundingClientRect();
            const px = e.clientX - rect.left;
            const py = e.clientY - rect.top;

            const offsetMs = Math.round(fromSvgX(px));
            const value = parseFloat(fromSvgY(py).toFixed(3));

            dispatch({
                type: 'ADD_KEYFRAME',
                payload: {
                    keyframe: {
                        id: crypto.randomUUID(),
                        clipId: clip.id,
                        property: selectedProperty,
                        offsetMs,
                        value,
                        easing: 'linear',
                        bezierCp1X: null,
                        bezierCp1Y: null,
                        bezierCp2X: null,
                        bezierCp2Y: null,
                        createdAt: new Date().toISOString(),
                    },
                },
            });
        },
        [clip.id, selectedProperty, fromSvgX, fromSvgY, dispatch],
    );

    const handleDiamondMouseDown = useCallback(
        (idx: number, e: React.MouseEvent) => {
            e.stopPropagation();
            e.preventDefault();
            setDragIdx(idx);

            const svg = svgRef.current;
            if (!svg) return;

            const handleMouseMove = (me: MouseEvent) => {
                const rect = svg.getBoundingClientRect();
                const px = me.clientX - rect.left;
                const py = me.clientY - rect.top;

                const kf = propKeyframes[idx];
                if (!kf) return;

                dispatch({
                    type: 'UPDATE_KEYFRAME',
                    payload: {
                        keyframeId: kf.id,
                        changes: {
                            offsetMs: Math.round(fromSvgX(px)),
                            value: parseFloat(fromSvgY(py).toFixed(3)),
                        },
                    },
                });
            };

            const handleMouseUp = () => {
                setDragIdx(null);
                window.removeEventListener('mousemove', handleMouseMove);
                window.removeEventListener('mouseup', handleMouseUp);
            };

            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        },
        [propKeyframes, fromSvgX, fromSvgY, dispatch],
    );

    const handleDeleteKeyframe = useCallback(
        (kfId: string) => {
            dispatch({ type: 'REMOVE_KEYFRAME', payload: { keyframeId: kfId } });
        },
        [dispatch],
    );

    const handleSetEasing = useCallback(
        (easing: KeyframeEasing) => {
            // Apply easing to all selected (or all if none selected) keyframes
            for (const kf of propKeyframes) {
                dispatch({
                    type: 'UPDATE_KEYFRAME',
                    payload: {
                        keyframeId: kf.id,
                        changes: { easing },
                    },
                });
            }
        },
        [propKeyframes, dispatch],
    );

    return (
        <div className="flex flex-col gap-2">
            {/* Header */}
            <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                    Keyframes
                </span>
                <span className="text-[9px] text-zinc-500">{propKeyframes.length} pts</span>
            </div>

            {/* Property selector */}
            <select
                className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300"
                value={selectedProperty}
                onChange={(e) => setSelectedProperty(e.target.value as KeyframeProperty)}
            >
                {PROPERTY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                        {opt.label}
                    </option>
                ))}
            </select>

            {/* SVG Curve Canvas */}
            <div className="overflow-hidden rounded-md border border-zinc-700 bg-zinc-900">
                <svg
                    ref={svgRef}
                    width={SVG_WIDTH}
                    height={SVG_HEIGHT}
                    className="cursor-crosshair"
                    onDoubleClick={handleDoubleClick}
                >
                    {/* Grid lines */}
                    {[0.25, 0.5, 0.75].map((frac) => (
                        <line
                            key={`h-${frac}`}
                            x1={PADDING}
                            y1={PADDING + graphH * frac}
                            x2={SVG_WIDTH - PADDING}
                            y2={PADDING + graphH * frac}
                            stroke="#333"
                            strokeWidth={0.5}
                        />
                    ))}
                    {[0.25, 0.5, 0.75].map((frac) => (
                        <line
                            key={`v-${frac}`}
                            x1={PADDING + graphW * frac}
                            y1={PADDING}
                            x2={PADDING + graphW * frac}
                            y2={SVG_HEIGHT - PADDING}
                            stroke="#333"
                            strokeWidth={0.5}
                        />
                    ))}

                    {/* Axis border */}
                    <rect
                        x={PADDING}
                        y={PADDING}
                        width={graphW}
                        height={graphH}
                        fill="none"
                        stroke="#444"
                        strokeWidth={1}
                    />

                    {/* Curve */}
                    <path d={curvePath} fill="none" stroke={propOption.color} strokeWidth={1.5} />

                    {/* Diamond markers */}
                    {propKeyframes.map((kf, i) => {
                        const cx = toSvgX(kf.offsetMs);
                        const cy = toSvgY(kf.value);

                        return (
                            <g key={kf.id}>
                                {/* Diamond shape (rotated square) */}
                                <rect
                                    x={cx - DIAMOND_SIZE / 2}
                                    y={cy - DIAMOND_SIZE / 2}
                                    width={DIAMOND_SIZE}
                                    height={DIAMOND_SIZE}
                                    fill={propOption.color}
                                    stroke="#fff"
                                    strokeWidth={dragIdx === i ? 2 : 1}
                                    transform={`rotate(45 ${cx} ${cy})`}
                                    className="cursor-grab active:cursor-grabbing"
                                    onMouseDown={(e) => handleDiamondMouseDown(i, e)}
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        handleDeleteKeyframe(kf.id);
                                    }}
                                />
                                {/* Easing label */}
                                <text
                                    x={cx}
                                    y={cy - DIAMOND_SIZE - 2}
                                    textAnchor="middle"
                                    fill="#666"
                                    fontSize={7}
                                >
                                    {kf.easing === 'linear' ? '' : kf.easing.replace('_', ' ')}
                                </text>
                            </g>
                        );
                    })}
                </svg>
            </div>

            {/* Easing presets */}
            <div className="flex gap-1">
                {EASING_PRESETS.map(({ value, label }) => (
                    <button
                        key={value}
                        className="flex-1 rounded bg-zinc-800 px-1 py-0.5 text-[8px] text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
                        onClick={() => handleSetEasing(value)}
                        title={`Set all to ${label}`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {/* Instructions */}
            <p className="text-[8px] leading-tight text-zinc-600">
                Double-click to add • Drag ◆ to move • Right-click ◆ to delete
            </p>
        </div>
    );
}
