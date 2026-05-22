'use client';

/**
 * PlaybackEngine — drives the timeline playback loop.
 *
 * Uses requestAnimationFrame to advance the playhead at real-time speed.
 * Supports shuttle speeds (J/K/L), frame stepping, and subscriber callbacks.
 *
 * Usage:
 *   const engine = new PlaybackEngine();
 *   engine.onTick = (ms) => dispatch({ type: 'SET_PLAYHEAD', payload: { ms } });
 *   engine.play();
 */

// ──────────────────────────────────────────
// Constants
// ──────────────────────────────────────────

const SHUTTLE_SPEEDS = [1, 2, 4, 8] as const;

// ──────────────────────────────────────────
// PlaybackEngine
// ──────────────────────────────────────────

export class PlaybackEngine {
  /** Current position in milliseconds */
  private _currentMs = 0;

  /** Whether playback is active */
  private _isPlaying = false;

  /** rAF handle for cancellation */
  private _rafId: number | null = null;

  /** Timestamp of the last rAF callback */
  private _lastTimestamp: number | null = null;

  /** Playback speed multiplier (negative = reverse) */
  private _speed = 1;

  /** Current shuttle index into SHUTTLE_SPEEDS (for J/K/L multi-tap) */
  private _shuttleIndex = 0;

  /** Shuttle direction: 1 = forward, -1 = reverse, 0 = paused */
  private _shuttleDirection: -1 | 0 | 1 = 0;

  /** Total timeline duration (auto-stop boundary) */
  private _durationMs = 0;

  /** FPS for frame-step calculations */
  private _fps = 30;

  /** Subscriber callback — called each frame with current ms */
  onTick: ((ms: number) => void) | null = null;

  /** Called when playback starts */
  onPlay: (() => void) | null = null;

  /** Called when playback pauses or stops */
  onPause: (() => void) | null = null;

  // ── Getters ──

  get currentMs() {
    return this._currentMs;
  }

  get isPlaying() {
    return this._isPlaying;
  }

  get speed() {
    return this._speed;
  }

  // ── Configuration ──

  setDuration(ms: number) {
    this._durationMs = ms;
  }

  setFps(fps: number) {
    this._fps = fps;
  }

  // ── Core playback controls ──

  play() {
    if (this._isPlaying) return;

    this._isPlaying = true;
    this._lastTimestamp = null;
    this._speed = 1;
    this._shuttleDirection = 1;
    this._shuttleIndex = 0;

    this._startLoop();
    this.onPlay?.();
  }

  pause() {
    if (!this._isPlaying) return;

    this._isPlaying = false;
    this._cancelLoop();
    this._shuttleDirection = 0;
    this._shuttleIndex = 0;

    this.onPause?.();
  }

  stop() {
    this.pause();
    this._currentMs = 0;
    this.onTick?.(0);
  }

  togglePlayPause() {
    if (this._isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  // ── Seeking ──

  seekTo(ms: number) {
    this._currentMs = Math.max(0, Math.min(ms, this._durationMs || Infinity));
    this._lastTimestamp = null; // Reset timestamp to avoid time jumps
    this.onTick?.(this._currentMs);
  }

  // ── Shuttle (J/K/L) ──

  /**
   * Shuttle forward. Multi-tap increases speed: 1× → 2× → 4× → 8×.
   */
  shuttleForward() {
    if (this._shuttleDirection === 1) {
      // Already going forward — increase speed
      this._shuttleIndex = Math.min(
        this._shuttleIndex + 1,
        SHUTTLE_SPEEDS.length - 1,
      );
    } else {
      // Start forward from 1×
      this._shuttleDirection = 1;
      this._shuttleIndex = 0;
    }

    this._speed = SHUTTLE_SPEEDS[this._shuttleIndex]!;

    if (!this._isPlaying) {
      this._isPlaying = true;
      this._lastTimestamp = null;
      this._startLoop();
      this.onPlay?.();
    }
  }

  /**
   * Shuttle reverse. Multi-tap increases speed: -1× → -2× → -4× → -8×.
   */
  shuttleReverse() {
    if (this._shuttleDirection === -1) {
      // Already going reverse — increase speed
      this._shuttleIndex = Math.min(
        this._shuttleIndex + 1,
        SHUTTLE_SPEEDS.length - 1,
      );
    } else {
      // Start reverse from -1×
      this._shuttleDirection = -1;
      this._shuttleIndex = 0;
    }

    this._speed = -SHUTTLE_SPEEDS[this._shuttleIndex]!;

    if (!this._isPlaying) {
      this._isPlaying = true;
      this._lastTimestamp = null;
      this._startLoop();
      this.onPlay?.();
    }
  }

  /**
   * Shuttle pause (K key). Resets speed and stops playback.
   */
  shuttlePause() {
    this.pause();
  }

  // ── Frame stepping ──

  stepForward() {
    if (this._isPlaying) this.pause();
    const frameDurationMs = 1000 / this._fps;
    this.seekTo(this._currentMs + frameDurationMs);
  }

  stepBackward() {
    if (this._isPlaying) this.pause();
    const frameDurationMs = 1000 / this._fps;
    this.seekTo(this._currentMs - frameDurationMs);
  }

  // ── Cleanup ──

  dispose() {
    this._cancelLoop();
    this.onTick = null;
    this.onPlay = null;
    this.onPause = null;
  }

  // ── Internal rAF loop ──

  private _startLoop() {
    const tick = (timestamp: number) => {
      if (!this._isPlaying) return;

      if (this._lastTimestamp !== null) {
        const deltaMs = (timestamp - this._lastTimestamp) * this._speed;
        this._currentMs += deltaMs;

        // Clamp to bounds
        if (this._currentMs >= this._durationMs && this._durationMs > 0) {
          this._currentMs = this._durationMs;
          this.pause();
          this.onTick?.(this._currentMs);
          return;
        }

        if (this._currentMs < 0) {
          this._currentMs = 0;
          this.pause();
          this.onTick?.(this._currentMs);
          return;
        }

        this.onTick?.(this._currentMs);
      }

      this._lastTimestamp = timestamp;
      this._rafId = requestAnimationFrame(tick);
    };

    this._rafId = requestAnimationFrame(tick);
  }

  private _cancelLoop() {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._lastTimestamp = null;
  }
}
