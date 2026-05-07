'use client';

/**
 * TransitionRenderer — canvas rendering functions for transitions between clips.
 *
 * Called during the overlap region between two adjacent clips.
 * Each function receives the canvas context, the two frames (as ImageBitmap or video),
 * and a progress value (0→1) indicating how far through the transition we are.
 */
import type { TransitionType } from './schemas';

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

export interface TransitionFrame {
  /** The video element with the current frame ready */
  source: CanvasImageSource;
  /** Draw dimensions */
  drawX: number;
  drawY: number;
  drawW: number;
  drawH: number;
}

export interface TransitionRenderParams {
  ctx: CanvasRenderingContext2D;
  canvasW: number;
  canvasH: number;
  /** Outgoing clip's current frame */
  outgoing: TransitionFrame;
  /** Incoming clip's current frame */
  incoming: TransitionFrame;
  /** 0 = transition start (100% outgoing), 1 = transition end (100% incoming) */
  progress: number;
}

// ──────────────────────────────────────────
// Transition rendering functions
// ──────────────────────────────────────────

/**
 * Crossfade — simple alpha blend between two frames.
 */
function renderCrossfade({
  ctx,
  outgoing,
  incoming,
  progress,
}: TransitionRenderParams) {
  // Draw outgoing at fading opacity
  ctx.globalAlpha = 1 - progress;
  ctx.drawImage(
    outgoing.source,
    outgoing.drawX,
    outgoing.drawY,
    outgoing.drawW,
    outgoing.drawH,
  );

  // Draw incoming at increasing opacity
  ctx.globalAlpha = progress;
  ctx.drawImage(
    incoming.source,
    incoming.drawX,
    incoming.drawY,
    incoming.drawW,
    incoming.drawH,
  );

  ctx.globalAlpha = 1;
}

/**
 * Fade through a solid color (black or white).
 * First half: outgoing fades to color. Second half: color fades to incoming.
 */
function renderFadeColor(
  {
    ctx,
    canvasW,
    canvasH,
    outgoing,
    incoming,
    progress,
  }: TransitionRenderParams,
  color: string,
) {
  if (progress < 0.5) {
    // First half: outgoing fades out to color
    const fadeOut = 1 - progress * 2; // 1→0
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.globalAlpha = fadeOut;
    ctx.drawImage(
      outgoing.source,
      outgoing.drawX,
      outgoing.drawY,
      outgoing.drawW,
      outgoing.drawH,
    );
  } else {
    // Second half: incoming fades in from color
    const fadeIn = (progress - 0.5) * 2; // 0→1
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.globalAlpha = fadeIn;
    ctx.drawImage(
      incoming.source,
      incoming.drawX,
      incoming.drawY,
      incoming.drawW,
      incoming.drawH,
    );
  }

  ctx.globalAlpha = 1;
}

function renderFadeBlack(params: TransitionRenderParams) {
  renderFadeColor(params, '#000');
}

function renderFadeWhite(params: TransitionRenderParams) {
  renderFadeColor(params, '#fff');
}

/**
 * Dissolve — pixel-level blend using composite operations.
 * Uses 'lighter' composite with controlled alpha for a smoother dissolve effect.
 */
function renderDissolve({
  ctx,
  outgoing,
  incoming,
  progress,
}: TransitionRenderParams) {
  // Draw outgoing first
  ctx.globalAlpha = 1 - progress;
  ctx.drawImage(
    outgoing.source,
    outgoing.drawX,
    outgoing.drawY,
    outgoing.drawW,
    outgoing.drawH,
  );

  // Blend incoming on top with additive-like composite
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = progress;
  ctx.drawImage(
    incoming.source,
    incoming.drawX,
    incoming.drawY,
    incoming.drawW,
    incoming.drawH,
  );

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

/**
 * Wipe — clip-path based wipe transition.
 * Direction determines which edge the wipe travels from.
 */
function renderWipe(
  {
    ctx,
    canvasW,
    canvasH,
    outgoing,
    incoming,
    progress,
  }: TransitionRenderParams,
  direction: 'left' | 'right',
) {
  // Draw outgoing as background
  ctx.drawImage(
    outgoing.source,
    outgoing.drawX,
    outgoing.drawY,
    outgoing.drawW,
    outgoing.drawH,
  );

  // Clip and draw incoming over the revealed region
  ctx.save();
  ctx.beginPath();

  if (direction === 'left') {
    // Wipe from left to right: incoming is revealed left-to-right
    ctx.rect(0, 0, canvasW * progress, canvasH);
  } else {
    // Wipe from right to left: incoming is revealed right-to-left
    ctx.rect(canvasW * (1 - progress), 0, canvasW * progress, canvasH);
  }

  ctx.clip();
  ctx.drawImage(
    incoming.source,
    incoming.drawX,
    incoming.drawY,
    incoming.drawW,
    incoming.drawH,
  );
  ctx.restore();
}

function renderWipeLeft(params: TransitionRenderParams) {
  renderWipe(params, 'left');
}

function renderWipeRight(params: TransitionRenderParams) {
  renderWipe(params, 'right');
}

// ──────────────────────────────────────────
// Public API
// ──────────────────────────────────────────

/** Map of transition type to render function */
const RENDERERS: Record<
  Exclude<TransitionType, 'cut'>,
  (params: TransitionRenderParams) => void
> = {
  crossfade: renderCrossfade,
  fade_black: renderFadeBlack,
  fade_white: renderFadeWhite,
  dissolve: renderDissolve,
  wipe_left: renderWipeLeft,
  wipe_right: renderWipeRight,
};

/**
 * Render a transition between two clips.
 * Returns false if the transition type is 'cut' (no rendering needed).
 */
export function renderTransition(
  type: TransitionType,
  params: TransitionRenderParams,
): boolean {
  if (type === 'cut') return false;

  const renderer = RENDERERS[type];
  if (!renderer) return false;

  renderer(params);
  return true;
}

/**
 * Calculate transition progress given playhead position and transition timing.
 * Returns null if playhead is not within the transition region.
 */
export function getTransitionProgress(
  playheadMs: number,
  transitionStartMs: number,
  transitionDurationMs: number,
): number | null {
  if (playheadMs < transitionStartMs) return null;
  if (playheadMs >= transitionStartMs + transitionDurationMs) return null;

  return (playheadMs - transitionStartMs) / transitionDurationMs;
}
