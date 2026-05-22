'use client';

/**
 * AudioEngine — Web Audio API integration for the Edit Suite timeline.
 *
 * Manages an AudioContext and a GainNode routing graph:
 *   AudioBufferSourceNode → clipGainNode → trackGainNode → masterGainNode → destination
 *
 * Features:
 * - Decode & cache audio buffers by mediaUrl
 * - Per-clip volume + per-track volume
 * - Mute / solo logic at the track level
 * - Start/stop/seek synchronised with PlaybackEngine
 *
 * Audio track types: dialogue, music, sfx, ambient, upload
 * (Non-audio types: video, title — ignored by AudioEngine)
 */
import {
  getKeyframesForProperty,
  interpolateKeyframes,
} from './keyframe-engine';
import type { EditClip, EditKeyframe, EditTrack } from './types';

// ──────────────────────────────────────────
// Constants
// ──────────────────────────────────────────

const AUDIO_TRACK_TYPES = new Set([
  'dialogue',
  'music',
  'sfx',
  'ambient',
  'upload',
]);

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

interface ActiveSource {
  source: AudioBufferSourceNode;
  clipGain: GainNode;
  clipId: string;
  trackId: string;
  /** Start time in AudioContext time */
  contextStartTime: number;
  /** Offset within the audio buffer at which playback started (seconds) */
  bufferOffsetSec: number;
}

// ──────────────────────────────────────────
// AudioEngine
// ──────────────────────────────────────────

export class AudioEngine {
  private _ctx: AudioContext | null = null;
  private _masterGain: GainNode | null = null;
  private _trackGains: Map<string, GainNode> = new Map();
  private _activeSources: ActiveSource[] = [];
  private _bufferCache: Map<string, AudioBuffer> = new Map();
  private _pendingDecodes: Map<string, Promise<AudioBuffer | null>> = new Map();

  // ── Lazy AudioContext ──

  private getContext(): AudioContext {
    if (!this._ctx) {
      this._ctx = new AudioContext();
      this._masterGain = this._ctx.createGain();
      this._masterGain.connect(this._ctx.destination);
    }
    return this._ctx;
  }

  private getMasterGain(): GainNode {
    this.getContext();
    return this._masterGain!;
  }

  // ── Buffer decode & cache ──

  private async decodeUrl(url: string): Promise<AudioBuffer | null> {
    // Return from cache
    const cached = this._bufferCache.get(url);
    if (cached) return cached;

    // Dedupe pending decodes
    const pending = this._pendingDecodes.get(url);
    if (pending) return pending;

    const promise = (async () => {
      try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer =
          await this.getContext().decodeAudioData(arrayBuffer);
        this._bufferCache.set(url, audioBuffer);
        return audioBuffer;
      } catch (error) {
        console.error(`Failed to decode audio from URL: ${url}`, error);
        // Audio decode failed (probably not an audio file, or CORS)
        return null;
      } finally {
        this._pendingDecodes.delete(url);
      }
    })();

    this._pendingDecodes.set(url, promise);
    return promise;
  }

  // ── Track gain management ──

  private getOrCreateTrackGain(trackId: string): GainNode {
    const existing = this._trackGains.get(trackId);
    if (existing) return existing;

    const ctx = this.getContext();
    const gain = ctx.createGain();
    gain.connect(this.getMasterGain());
    this._trackGains.set(trackId, gain);
    return gain;
  }

  /**
   * Update track audio state (volume, mute/solo).
   * Call whenever tracks array changes.
   */
  updateTracks(tracks: EditTrack[]) {
    const hasSolo = tracks.some(
      (t) => t.isSolo && AUDIO_TRACK_TYPES.has(t.type),
    );

    for (const track of tracks) {
      if (!AUDIO_TRACK_TYPES.has(track.type)) continue;

      const gain = this.getOrCreateTrackGain(track.id);
      let volume = track.volume;

      // Mute logic
      if (track.isMuted) {
        volume = 0;
      }

      // Solo logic: if any track is solo, mute all non-solo tracks
      if (hasSolo && !track.isSolo) {
        volume = 0;
      }

      gain.gain.setValueAtTime(volume, this.getContext().currentTime);
    }
  }

  // ── Playback control ──

  /**
   * Start playing all audio clips that overlap the given playhead position.
   * Called when PlaybackEngine starts or after a seek during playback.
   */
  async startPlayback(
    playheadMs: number,
    clips: EditClip[],
    tracks: EditTrack[],
    speed: number = 1,
    keyframes: EditKeyframe[] = [],
  ) {
    this.stopPlayback();
    this.updateTracks(tracks);

    // Resume context (required after user gesture)
    const ctx = this.getContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const audioClips = clips.filter(
      (c) =>
        c.isActive &&
        c.mediaUrl &&
        c.startMs <= playheadMs &&
        c.endMs > playheadMs &&
        this.isAudioTrack(c.trackId, tracks),
    );

    for (const clip of audioClips) {
      await this.scheduleClip(clip, playheadMs, speed, keyframes);
    }
  }

  /**
   * Stop all currently playing audio sources.
   */
  stopPlayback() {
    for (const active of this._activeSources) {
      try {
        active.source.stop();
      } catch {
        // Already stopped
      }
      active.source.disconnect();
      active.clipGain.disconnect();
    }
    this._activeSources = [];
  }

  /**
   * Sync audio to a new playhead position during playback.
   * Checks which clips need to start/stop and reschedules.
   */
  async syncToPlayhead(
    playheadMs: number,
    clips: EditClip[],
    tracks: EditTrack[],
    speed: number = 1,
    keyframes: EditKeyframe[] = [],
  ) {
    const ctx = this.getContext();

    // Determine which clips should be playing
    const shouldPlay = new Set(
      clips
        .filter(
          (c) =>
            c.isActive &&
            c.mediaUrl &&
            c.startMs <= playheadMs &&
            c.endMs > playheadMs &&
            this.isAudioTrack(c.trackId, tracks),
        )
        .map((c) => c.id),
    );

    // Stop clips that are no longer active
    const toKeep: ActiveSource[] = [];
    for (const active of this._activeSources) {
      if (!shouldPlay.has(active.clipId)) {
        try {
          active.source.stop();
        } catch {
          /* already stopped */
        }
        active.source.disconnect();
        active.clipGain.disconnect();
      } else {
        toKeep.push(active);
        shouldPlay.delete(active.clipId); // Already playing
      }
    }
    this._activeSources = toKeep;

    // Schedule new clips that should start
    for (const clipId of shouldPlay) {
      const clip = clips.find((c) => c.id === clipId);
      if (clip) {
        await this.scheduleClip(clip, playheadMs, speed, keyframes);
      }
    }

    // Update playback rates for speed changes
    for (const active of this._activeSources) {
      if (active.source.playbackRate.value !== Math.abs(speed)) {
        active.source.playbackRate.setValueAtTime(
          Math.abs(speed),
          ctx.currentTime,
        );
      }
    }
  }

  // ── Internal scheduling ──

  private async scheduleClip(
    clip: EditClip,
    playheadMs: number,
    speed: number,
    keyframes: EditKeyframe[] = [],
  ) {
    if (!clip.mediaUrl) return;

    const buffer = await this.decodeUrl(clip.mediaUrl);
    if (!buffer) return;

    const ctx = this.getContext();

    // Calculate where in the source buffer to start
    const clipOffsetMs = playheadMs - clip.startMs + clip.inPointMs;
    const offsetSec = Math.max(0, clipOffsetMs / 1000);

    // How long until the clip naturally ends
    const remainingMs = clip.endMs - playheadMs;
    const durationSec = Math.max(0, remainingMs / 1000 / Math.abs(speed));

    // Don't play if past the buffer length
    if (offsetSec >= buffer.duration) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = Math.abs(speed) * (clip.speed || 1);

    // Clip-level gain
    const clipGain = ctx.createGain();
    clipGain.gain.value = clip.volume;

    // Route: source → clipGain → trackGain → masterGain → destination
    const trackGain = this.getOrCreateTrackGain(clip.trackId);
    source.connect(clipGain);
    clipGain.connect(trackGain);

    // Schedule volume keyframes on the clip gain node
    this.scheduleVolumeKeyframes(clipGain, clip, playheadMs, keyframes);

    // Start playback
    source.start(0, offsetSec, durationSec);

    // Auto-cleanup when source ends
    source.onended = () => {
      this._activeSources = this._activeSources.filter(
        (a) => a.clipId !== clip.id,
      );
      source.disconnect();
      clipGain.disconnect();
    };

    this._activeSources.push({
      source,
      clipGain,
      clipId: clip.id,
      trackId: clip.trackId,
      contextStartTime: ctx.currentTime,
      bufferOffsetSec: offsetSec,
    });
  }

  /**
   * Schedule volume keyframes as Web Audio gain ramps.
   * Uses linearRampToValueAtTime for smooth interpolation,
   * and setValueAtTime for 'hold' easing (step function).
   */
  private scheduleVolumeKeyframes(
    clipGain: GainNode,
    clip: EditClip,
    playheadMs: number,
    allKeyframes: EditKeyframe[],
  ) {
    const volumeKfs = getKeyframesForProperty(allKeyframes, clip.id, 'volume');
    if (volumeKfs.length === 0) return;

    const ctx = this.getContext();
    const now = ctx.currentTime;
    const clipOffsetMs = playheadMs - clip.startMs;

    // Cancel any previous scheduled ramps
    clipGain.gain.cancelScheduledValues(now);

    // Set current interpolated volume
    const currentVolume = interpolateKeyframes(volumeKfs, clipOffsetMs);
    clipGain.gain.setValueAtTime(currentVolume * clip.volume, now);

    // Schedule future keyframes
    for (const kf of volumeKfs) {
      if (kf.offsetMs <= clipOffsetMs) continue; // Already past

      const futureOffsetSec = (kf.offsetMs - clipOffsetMs) / 1000;
      const targetTime = now + futureOffsetSec;
      const value = kf.value * clip.volume;

      if (kf.easing === 'hold') {
        clipGain.gain.setValueAtTime(value, targetTime);
      } else {
        clipGain.gain.linearRampToValueAtTime(value, targetTime);
      }
    }
  }

  // ── Helpers ──

  private isAudioTrack(trackId: string, tracks: EditTrack[]): boolean {
    const track = tracks.find((t) => t.id === trackId);
    return track ? AUDIO_TRACK_TYPES.has(track.type) : false;
  }

  /**
   * Pre-decode audio buffers for given clips (fire-and-forget).
   * Call after auto-assembly to start caching in the background.
   */
  preloadClips(clips: EditClip[]) {
    for (const clip of clips) {
      if (clip.mediaUrl) {
        void this.decodeUrl(clip.mediaUrl);
      }
    }
  }

  /**
   * Get a decoded AudioBuffer for waveform rendering.
   */
  async getAudioBuffer(url: string): Promise<AudioBuffer | null> {
    return this.decodeUrl(url);
  }

  // ── Cleanup ──

  dispose() {
    this.stopPlayback();
    this._trackGains.clear();
    this._bufferCache.clear();
    this._pendingDecodes.clear();

    if (this._ctx) {
      void this._ctx.close();
      this._ctx = null;
      this._masterGain = null;
    }
  }
}
