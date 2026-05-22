'use client';

/**
 * KeyframeEngine — interpolation engine for keyframe animation.
 *
 * Implements all 6 easing types:
 *   linear, ease_in (quadratic), ease_out, ease_in_out, hold (step), bezier (cubic)
 *
 * Public API:
 *   - interpolateKeyframes(keyframes, offsetMs) → interpolated value
 *   - getInterpolatedValues(allKeyframes, clipId, offsetMs) → Record<property, value>
 */
import type { KeyframeEasing, KeyframeProperty } from './schemas';
import type { EditKeyframe } from './types';

// ──────────────────────────────────────────
// Easing functions (t in 0→1, returns 0→1)
// ──────────────────────────────────────────

function easeLinear(t: number): number {
  return t;
}

function easeIn(t: number): number {
  return t * t;
}

function easeOut(t: number): number {
  return t * (2 - t);
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

function easeHold(_t: number): number {
  return 0; // Step function: holds previous value until next keyframe
}

/**
 * Evaluate a cubic bezier curve at parameter t.
 * Control points: P0=(0,0), P1=(cp1x,cp1y), P2=(cp2x,cp2y), P3=(1,1)
 *
 * Uses De Casteljau's algorithm for numerical stability.
 */
function cubicBezierY(
  t: number,
  cp1x: number,
  cp1y: number,
  cp2x: number,
  cp2y: number,
): number {
  // First, find the t parameter for the X axis using Newton's method
  const tForX = solveCubicBezierX(t, cp1x, cp2x);
  // Then evaluate Y at that parameter
  return evaluateBezier(tForX, 0, cp1y, cp2y, 1);
}

/** Evaluate a cubic bezier at parameter t with given control points */
function evaluateBezier(
  t: number,
  p0: number,
  p1: number,
  p2: number,
  p3: number,
): number {
  const mt = 1 - t;
  return (
    mt * mt * mt * p0 +
    3 * mt * mt * t * p1 +
    3 * mt * t * t * p2 +
    t * t * t * p3
  );
}

/** Derivative of cubic bezier for Newton's method */
function bezierDerivative(
  t: number,
  p0: number,
  p1: number,
  p2: number,
  p3: number,
): number {
  const mt = 1 - t;
  return (
    3 * mt * mt * (p1 - p0) + 6 * mt * t * (p2 - p1) + 3 * t * t * (p3 - p2)
  );
}

const NEWTON_ITERATIONS = 8;
const NEWTON_EPSILON = 1e-7;

/** Solve for the t parameter that gives us a specific X value on the bezier curve */
function solveCubicBezierX(x: number, cp1x: number, cp2x: number): number {
  let t = x; // Initial guess

  for (let i = 0; i < NEWTON_ITERATIONS; i++) {
    const currentX = evaluateBezier(t, 0, cp1x, cp2x, 1);
    const dx = currentX - x;

    if (Math.abs(dx) < NEWTON_EPSILON) break;

    const derivative = bezierDerivative(t, 0, cp1x, cp2x, 1);
    if (Math.abs(derivative) < NEWTON_EPSILON) break;

    t -= dx / derivative;
    t = Math.max(0, Math.min(1, t));
  }

  return t;
}

// ──────────────────────────────────────────
// Easing map
// ──────────────────────────────────────────

const EASING_FNS: Record<
  Exclude<KeyframeEasing, 'bezier'>,
  (t: number) => number
> = {
  linear: easeLinear,
  ease_in: easeIn,
  ease_out: easeOut,
  ease_in_out: easeInOut,
  hold: easeHold,
};

// ──────────────────────────────────────────
// Public API
// ──────────────────────────────────────────

/**
 * Default values for each keyframe property (used when no keyframes exist).
 */
export const KEYFRAME_DEFAULTS: Record<KeyframeProperty, number> = {
  volume: 1,
  position_x: 0,
  position_y: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
};

/**
 * Interpolate between keyframes for a single property at a given offset.
 *
 * @param keyframes - Sorted array of keyframes for ONE property of ONE clip
 * @param offsetMs - Current playback offset within the clip
 * @returns Interpolated value
 */
export function interpolateKeyframes(
  keyframes: EditKeyframe[],
  offsetMs: number,
): number {
  if (keyframes.length === 0) {
    return KEYFRAME_DEFAULTS['volume'];
  }

  // Sort by offset (should already be sorted, but defensive)
  const sorted =
    keyframes.length > 1
      ? [...keyframes].sort((a, b) => a.offsetMs - b.offsetMs)
      : keyframes;

  // Before first keyframe: return first value
  const first = sorted[0]!;
  if (offsetMs <= first.offsetMs) {
    return first.value;
  }

  // After last keyframe: return last value
  const last = sorted[sorted.length - 1]!;
  if (offsetMs >= last.offsetMs) {
    return last.value;
  }

  // Find the surrounding keyframes
  let prevKf = first;
  let nextKf = sorted[1]!;

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.offsetMs >= offsetMs) {
      prevKf = sorted[i - 1]!;
      nextKf = sorted[i]!;
      break;
    }
  }

  // Calculate progress between the two keyframes
  const range = nextKf.offsetMs - prevKf.offsetMs;
  if (range <= 0) return prevKf.value;

  const t = (offsetMs - prevKf.offsetMs) / range;

  // Apply easing (using the outgoing keyframe's easing)
  let easedT: number;

  if (prevKf.easing === 'bezier') {
    easedT = cubicBezierY(
      t,
      prevKf.bezierCp1X ?? 0.25,
      prevKf.bezierCp1Y ?? 0.1,
      prevKf.bezierCp2X ?? 0.25,
      prevKf.bezierCp2Y ?? 1,
    );
  } else if (prevKf.easing === 'hold') {
    return prevKf.value; // Step function: no interpolation
  } else {
    const easingFn = EASING_FNS[prevKf.easing] ?? easeLinear;
    easedT = easingFn(t);
  }

  // Linear interpolation with eased t
  return prevKf.value + (nextKf.value - prevKf.value) * easedT;
}

/**
 * Get interpolated values for ALL properties of a clip at a given offset.
 *
 * @param allKeyframes - All keyframes in the project
 * @param clipId - The clip to get values for
 * @param offsetMs - Current playback offset within the clip
 * @returns Record mapping each property to its interpolated value (only properties with keyframes)
 */
export function getInterpolatedValues(
  allKeyframes: EditKeyframe[],
  clipId: string,
  offsetMs: number,
): Partial<Record<KeyframeProperty, number>> {
  // Filter keyframes for this clip
  const clipKeyframes = allKeyframes.filter((kf) => kf.clipId === clipId);
  if (clipKeyframes.length === 0) return {};

  // Group by property
  const byProperty = new Map<KeyframeProperty, EditKeyframe[]>();
  for (const kf of clipKeyframes) {
    const arr = byProperty.get(kf.property);
    if (arr) arr.push(kf);
    else byProperty.set(kf.property, [kf]);
  }

  // Interpolate each property
  const result: Partial<Record<KeyframeProperty, number>> = {};

  for (const [property, keyframes] of byProperty) {
    result[property] = interpolateKeyframes(keyframes, offsetMs);
  }

  return result;
}

/**
 * Get keyframes for a specific clip and property, sorted by offsetMs.
 */
export function getKeyframesForProperty(
  allKeyframes: EditKeyframe[],
  clipId: string,
  property: KeyframeProperty,
): EditKeyframe[] {
  return allKeyframes
    .filter((kf) => kf.clipId === clipId && kf.property === property)
    .sort((a, b) => a.offsetMs - b.offsetMs);
}
