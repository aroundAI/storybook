/**
 * FFmpeg Audio Mixer
 *
 * Builds FFmpeg filter graphs for mixing multiple audio tracks
 * with volume control, fades, and timing offsets.
 */
import type { Timeline } from '../schema/timeline';

// ============================================================================
// Types
// ============================================================================

export interface AudioStreamConfig {
  /** Input stream index */
  inputIndex: number;

  /** Stream label after processing */
  label: string;

  /** Volume adjustment (0-2) */
  volume: number;

  /** Fade in duration (seconds) */
  fadeIn: number;

  /** Fade out duration (seconds) */
  fadeOut: number;

  /** Clip duration for fade out timing */
  duration: number;

  /** Delay/offset on timeline (seconds) */
  delay: number;

  /** Track type for mixing priority */
  trackType: 'dialogue' | 'music' | 'sfx' | 'ambient';
}

export interface AudioMixConfig {
  /** All audio streams to mix */
  streams: AudioStreamConfig[];

  /** Total output duration */
  duration: number;

  /** Output sample rate */
  sampleRate: number;

  /** Output channels (1=mono, 2=stereo) */
  channels: number;

  /** Normalize output volume */
  normalize: boolean;
}

// ============================================================================
// Audio Filter Generation
// ============================================================================

/**
 * Build complete audio filter graph from timeline
 */
export function buildAudioFilterGraph(timeline: Timeline): {
  filters: string[];
  outputLabel: string;
} {
  const streams = extractAudioStreams(timeline);

  if (streams.length === 0) {
    // Generate silent audio
    return buildSilentAudio(timeline.duration);
  }

  const filters: string[] = [];
  const processedLabels: string[] = [];

  // Process each audio stream
  for (const stream of streams) {
    const { filters: streamFilters, outputLabel } = buildStreamFilters(stream);
    filters.push(...streamFilters);
    processedLabels.push(outputLabel);
  }

  // Mix all streams together
  if (processedLabels.length === 1) {
    return {
      filters,
      outputLabel: processedLabels[0] ?? 'aout',
    };
  }

  const { filter: mixFilter, outputLabel: mixOutput } = buildMixFilter(
    processedLabels,
    { normalize: true },
  );
  filters.push(mixFilter);

  // Trim to timeline duration
  filters.push(
    `[${mixOutput}]atrim=0:${timeline.duration},asetpts=PTS-STARTPTS[aout]`,
  );

  return {
    filters,
    outputLabel: 'aout',
  };
}

/**
 * Build filters for a single audio stream
 */
export function buildStreamFilters(config: AudioStreamConfig): {
  filters: string[];
  outputLabel: string;
} {
  const filters: string[] = [];
  let currentLabel = `${config.inputIndex}:a`;
  const nextLabel = () => `a${config.inputIndex}_${filters.length}`;

  // Volume adjustment
  if (config.volume !== 1) {
    const output = nextLabel();
    filters.push(`[${currentLabel}]volume=${config.volume}[${output}]`);
    currentLabel = output;
  }

  // Fade in
  if (config.fadeIn > 0) {
    const output = nextLabel();
    filters.push(`[${currentLabel}]afade=t=in:d=${config.fadeIn}[${output}]`);
    currentLabel = output;
  }

  // Fade out
  if (config.fadeOut > 0) {
    const output = nextLabel();
    const startTime = Math.max(0, config.duration - config.fadeOut);
    filters.push(
      `[${currentLabel}]afade=t=out:st=${startTime}:d=${config.fadeOut}[${output}]`,
    );
    currentLabel = output;
  }

  // Delay/offset on timeline
  if (config.delay > 0) {
    const output = config.label;
    const delayMs = Math.round(config.delay * 1000);
    filters.push(`[${currentLabel}]adelay=${delayMs}|${delayMs}[${output}]`);
    currentLabel = output;
  } else if (filters.length > 0) {
    // Rename last output to final label
    const lastFilter = filters[filters.length - 1];
    if (lastFilter) {
      filters[filters.length - 1] = lastFilter.replace(
        /\[([^\]]+)\]$/,
        `[${config.label}]`,
      );
    }
    currentLabel = config.label;
  } else {
    // No filters applied, just rename
    currentLabel = config.label;
  }

  return {
    filters,
    outputLabel: currentLabel,
  };
}

/**
 * Build audio mix filter for multiple streams
 */
export function buildMixFilter(
  inputLabels: string[],
  options: { normalize?: boolean; weights?: number[] } = {},
): { filter: string; outputLabel: string } {
  const { normalize = true, weights } = options;
  const outputLabel = 'amixed';

  const inputs = inputLabels.map((l) => `[${l}]`).join('');

  const mixParams: string[] = [`inputs=${inputLabels.length}`];

  if (weights && weights.length === inputLabels.length) {
    mixParams.push(`weights=${weights.join(' ')}`);
  }

  // dropout_transition: time to crossfade when an input ends
  mixParams.push('dropout_transition=0.5');

  // normalize: 0=off, 1=on
  mixParams.push(`normalize=${normalize ? 1 : 0}`);

  const filter = `${inputs}amix=${mixParams.join(':')}[${outputLabel}]`;

  return { filter, outputLabel };
}

/**
 * Build silent audio generator
 */
export function buildSilentAudio(
  duration: number,
  sampleRate = 48000,
): { filters: string[]; outputLabel: string } {
  return {
    filters: [`anullsrc=r=${sampleRate}:cl=stereo,atrim=0:${duration}[aout]`],
    outputLabel: 'aout',
  };
}

// ============================================================================
// Stream Extraction
// ============================================================================

/**
 * Extract audio streams from timeline
 */
function extractAudioStreams(timeline: Timeline): AudioStreamConfig[] {
  const streams: AudioStreamConfig[] = [];
  let inputIndex = 0;

  // Count video inputs first (they come before audio inputs)
  const videoTrack = timeline.tracks.find((t) => t.type === 'video');
  if (videoTrack) {
    inputIndex = videoTrack.clips.filter((c) => !c.isPlaceholder).length;
  }

  // Process each audio track
  const audioTracks = timeline.tracks.filter(
    (t) => t.type !== 'video' && !t.isMuted,
  );

  for (const track of audioTracks) {
    for (const clip of track.clips) {
      if (clip.isPlaceholder) continue;

      streams.push({
        inputIndex,
        label: `a${inputIndex}`,
        volume: (clip.volume ?? 1) * (track.volume ?? 1),
        fadeIn: clip.fadeIn ?? 0,
        fadeOut: clip.fadeOut ?? 0,
        duration: clip.duration,
        delay: clip.startTime,
        trackType: track.type as 'dialogue' | 'music' | 'sfx' | 'ambient',
      });

      inputIndex++;
    }
  }

  return streams;
}

// ============================================================================
// Audio Processing Utilities
// ============================================================================

/**
 * Build volume ramp filter (gradual volume change)
 */
export function buildVolumeRamp(
  inputLabel: string,
  outputLabel: string,
  startVolume: number,
  endVolume: number,
  duration: number,
): string {
  // Use volume filter with enable expression
  const rampExpr = `'${startVolume}+(${endVolume}-${startVolume})*t/${duration}'`;
  return `[${inputLabel}]volume=${rampExpr}:eval=frame[${outputLabel}]`;
}

/**
 * Build audio ducking filter (reduce background when dialogue plays)
 */
export function buildDuckingFilter(
  dialogueLabel: string,
  backgroundLabel: string,
  outputLabel: string,
  options: {
    threshold?: number;
    ratio?: number;
    attack?: number;
    release?: number;
  } = {},
): string {
  const { threshold = -20, ratio = 3, attack = 0.3, release = 1 } = options;

  // Use sidechaincompress to duck background based on dialogue
  return `[${backgroundLabel}][${dialogueLabel}]sidechaincompress=threshold=${threshold}dB:ratio=${ratio}:attack=${attack}:release=${release}[${outputLabel}]`;
}

/**
 * Build audio normalization filter
 */
export function buildNormalizeFilter(
  inputLabel: string,
  outputLabel: string,
  targetLoudness = -16, // LUFS
): string {
  return `[${inputLabel}]loudnorm=I=${targetLoudness}:TP=-1.5:LRA=11[${outputLabel}]`;
}

/**
 * Build EQ filter for common audio adjustments
 */
export function buildEQFilter(
  inputLabel: string,
  outputLabel: string,
  type: 'dialogue' | 'music' | 'bass_boost' | 'voice_enhance',
): string {
  switch (type) {
    case 'dialogue':
      // Boost presence, cut low rumble
      return `[${inputLabel}]equalizer=f=100:t=h:w=200:g=-3,equalizer=f=3000:t=q:w=1:g=2[${outputLabel}]`;

    case 'music':
      // Gentle low cut to make room for dialogue
      return `[${inputLabel}]highpass=f=60[${outputLabel}]`;

    case 'bass_boost':
      return `[${inputLabel}]equalizer=f=80:t=q:w=0.5:g=4[${outputLabel}]`;

    case 'voice_enhance':
      // Presence boost and de-ess
      return `[${inputLabel}]equalizer=f=2500:t=q:w=1.5:g=3,equalizer=f=6000:t=q:w=2:g=-2[${outputLabel}]`;

    default:
      return `[${inputLabel}]anull[${outputLabel}]`;
  }
}

/**
 * Calculate recommended volume levels for different track types
 */
export function getRecommendedVolumes(): Record<string, number> {
  return {
    dialogue: 1.0, // Primary audio, full volume
    music: 0.3, // Background, -10dB from dialogue
    sfx: 0.8, // Sound effects, slightly lower than dialogue
    ambient: 0.2, // Ambient, -14dB from dialogue
  };
}

/**
 * Calculate audio level in dB from linear volume
 */
export function linearToDb(linear: number): number {
  if (linear <= 0) return -Infinity;
  return 20 * Math.log10(linear);
}

/**
 * Calculate linear volume from dB
 */
export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}
