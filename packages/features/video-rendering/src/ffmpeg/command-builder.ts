/**
 * FFmpeg Command Builder
 *
 * Builds FFmpeg command-line arguments from timeline data.
 * Supports multiple concat approaches and transition effects.
 */
import type {
  Clip,
  RenderSettings,
  Timeline,
  Transition,
} from '../schema/timeline';

// ============================================================================
// Types
// ============================================================================

export interface FFmpegCommand {
  /** Input file arguments */
  inputs: FFmpegInput[];

  /** Global options before inputs */
  globalOptions: string[];

  /** Filter complex graph (if needed) */
  filterComplex?: string;

  /** Output options */
  outputOptions: string[];

  /** Output file path */
  outputPath: string;
}

export interface FFmpegInput {
  /** Input file path or URL */
  path: string;

  /** Input-specific options */
  options?: string[];
}

export interface FFmpegCommandOptions {
  /** Working directory for temp files */
  workingDir?: string;

  /** FFmpeg binary path */
  ffmpegPath?: string;

  /** Hardware acceleration */
  hwaccel?: 'none' | 'cuda' | 'videotoolbox' | 'qsv' | 'vaapi';

  /** Number of threads */
  threads?: number;

  /** Overwrite output without asking */
  overwrite?: boolean;
}

// ============================================================================
// Command Builder Functions
// ============================================================================

/**
 * Build complete FFmpeg command from timeline
 */
export function buildFFmpegCommand(
  timeline: Timeline,
  outputPath: string,
  options: FFmpegCommandOptions = {},
): FFmpegCommand {
  const videoClips = getVideoClips(timeline);
  const _audioClips = getAudioClips(timeline);
  const transitions = timeline.transitions;

  // Determine approach based on timeline complexity
  if (transitions.length === 0 && !hasAudioTracks(timeline)) {
    // Simple concat demuxer approach (no re-encoding)
    return buildConcatDemuxerCommand(
      videoClips,
      timeline.renderSettings,
      outputPath,
      options,
    );
  }

  // Full filter_complex approach for transitions and audio mixing
  return buildFilterComplexCommand(timeline, outputPath, options);
}

/**
 * Build command using concat demuxer (no re-encoding)
 */
export function buildConcatDemuxerCommand(
  clips: Clip[],
  settings: RenderSettings,
  outputPath: string,
  options: FFmpegCommandOptions = {},
): FFmpegCommand {
  const globalOptions = buildGlobalOptions(options);

  // Create concat file content
  const concatFilePath = `${options.workingDir ?? '/tmp'}/concat_${Date.now()}.txt`;

  // For concat demuxer, we use a single input with concat protocol
  const inputs: FFmpegInput[] = [
    {
      path: concatFilePath,
      options: ['-f', 'concat', '-safe', '0'],
    },
  ];

  const outputOptions = [
    '-c',
    'copy', // Copy streams without re-encoding
    ...buildOutputOptions(settings, false),
  ];

  return {
    inputs,
    globalOptions,
    outputOptions,
    outputPath,
  };
}

/**
 * Build command using filter_complex for transitions and effects
 */
export function buildFilterComplexCommand(
  timeline: Timeline,
  outputPath: string,
  options: FFmpegCommandOptions = {},
): FFmpegCommand {
  const globalOptions = buildGlobalOptions(options);
  const inputs = buildInputs(timeline);
  const filterComplex = buildFilterComplexGraph(timeline);
  const outputOptions = buildOutputOptions(timeline.renderSettings, true);

  return {
    inputs,
    globalOptions,
    filterComplex,
    outputOptions,
    outputPath,
  };
}

/**
 * Convert FFmpegCommand to command line string
 */
export function commandToString(
  command: FFmpegCommand,
  ffmpegPath = 'ffmpeg',
): string {
  const parts: string[] = [ffmpegPath];

  // Global options
  parts.push(...command.globalOptions);

  // Inputs
  for (const input of command.inputs) {
    if (input.options) {
      parts.push(...input.options);
    }
    parts.push('-i', input.path);
  }

  // Filter complex
  if (command.filterComplex) {
    parts.push('-filter_complex', command.filterComplex);
  }

  // Output options
  parts.push(...command.outputOptions);

  // Output path
  parts.push(command.outputPath);

  return parts.join(' ');
}

/**
 * Convert FFmpegCommand to array of arguments
 */
export function commandToArgs(command: FFmpegCommand): string[] {
  const args: string[] = [];

  // Global options
  args.push(...command.globalOptions);

  // Inputs
  for (const input of command.inputs) {
    if (input.options) {
      args.push(...input.options);
    }
    args.push('-i', input.path);
  }

  // Filter complex
  if (command.filterComplex) {
    args.push('-filter_complex', command.filterComplex);
  }

  // Output options
  args.push(...command.outputOptions);

  // Output path
  args.push(command.outputPath);

  return args;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build global FFmpeg options
 */
function buildGlobalOptions(options: FFmpegCommandOptions): string[] {
  const globalOpts: string[] = [];

  // Overwrite output
  if (options.overwrite !== false) {
    globalOpts.push('-y');
  }

  // Hardware acceleration
  if (options.hwaccel && options.hwaccel !== 'none') {
    globalOpts.push('-hwaccel', options.hwaccel);
  }

  // Threads
  if (options.threads) {
    globalOpts.push('-threads', options.threads.toString());
  }

  // Hide banner
  globalOpts.push('-hide_banner');

  return globalOpts;
}

/**
 * Build input list from timeline
 */
function buildInputs(timeline: Timeline): FFmpegInput[] {
  const inputs: FFmpegInput[] = [];
  const addedUrls = new Set<string>();

  // Add video clips
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if (!clip.isPlaceholder && !addedUrls.has(clip.assetUrl)) {
        inputs.push({ path: clip.assetUrl });
        addedUrls.add(clip.assetUrl);
      }
    }
  }

  return inputs;
}

/**
 * Build filter_complex graph
 */
function buildFilterComplexGraph(timeline: Timeline): string {
  const filters: string[] = [];
  const videoClips = getVideoClips(timeline);
  const transitions = timeline.transitions;

  // Build video chain
  const videoFilterChain = buildVideoFilterChain(
    videoClips,
    transitions,
    timeline,
  );
  filters.push(...videoFilterChain.filters);

  // Build audio chain
  const audioFilterChain = buildAudioFilterChain(timeline);
  filters.push(...audioFilterChain.filters);

  // Final output mapping
  filters.push(
    `[${videoFilterChain.output}][${audioFilterChain.output}]concat=n=1:v=1:a=1[outv][outa]`,
  );

  return filters.join(';');
}

/**
 * Build video filter chain with transitions
 */
function buildVideoFilterChain(
  clips: Clip[],
  transitions: Transition[],
  timeline: Timeline,
): { filters: string[]; output: string } {
  const filters: string[] = [];

  if (clips.length === 0) {
    return { filters: [], output: 'v' };
  }

  if (clips.length === 1) {
    // Single clip, just scale and format
    const settings = timeline.renderSettings;
    filters.push(
      `[0:v]scale=${settings.width}:${settings.height},setsar=1[v0]`,
    );
    return { filters, output: 'v0' };
  }

  // Process each clip with scaling
  const settings = timeline.renderSettings;
  for (let i = 0; i < clips.length; i++) {
    filters.push(
      `[${i}:v]scale=${settings.width}:${settings.height},setsar=1,fps=${settings.fps}[v${i}]`,
    );
  }

  // Apply transitions between clips
  let currentOutput = 'v0';
  for (let i = 0; i < clips.length - 1; i++) {
    const currentClip = clips[i];
    const nextClip = clips[i + 1];
    if (!currentClip || !nextClip) continue;

    const transition = transitions.find(
      (t) => t.clipBeforeId === currentClip.id && t.clipAfterId === nextClip.id,
    );

    const nextOutput = i === clips.length - 2 ? 'vout' : `vt${i}`;

    if (transition && transition.type !== 'cut') {
      // Apply transition filter
      const transitionFilter = buildTransitionFilter(
        currentOutput,
        `v${i + 1}`,
        transition,
        nextOutput,
      );
      filters.push(transitionFilter);
    } else {
      // Simple concat for cut transitions
      filters.push(
        `[${currentOutput}][v${i + 1}]concat=n=2:v=1:a=0[${nextOutput}]`,
      );
    }

    currentOutput = nextOutput;
  }

  return { filters, output: currentOutput };
}

/**
 * Build transition filter string
 */
function buildTransitionFilter(
  input1: string,
  input2: string,
  transition: Transition,
  output: string,
): string {
  const duration = transition.duration;

  switch (transition.type) {
    case 'fade':
      return `[${input1}][${input2}]xfade=transition=fade:duration=${duration}[${output}]`;

    case 'crossfade':
      return `[${input1}][${input2}]xfade=transition=fade:duration=${duration}[${output}]`;

    case 'wipe': {
      const direction = transition.params?.direction ?? 'left';
      const wipeType = getWipeType(direction);
      return `[${input1}][${input2}]xfade=transition=${wipeType}:duration=${duration}[${output}]`;
    }

    case 'dissolve':
      return `[${input1}][${input2}]xfade=transition=pixelize:duration=${duration}[${output}]`;

    case 'slide': {
      const direction = transition.params?.direction ?? 'left';
      const slideType = getSlideType(direction);
      return `[${input1}][${input2}]xfade=transition=${slideType}:duration=${duration}[${output}]`;
    }

    default:
      // Fallback to simple concat
      return `[${input1}][${input2}]concat=n=2:v=1:a=0[${output}]`;
  }
}

/**
 * Map wipe direction to FFmpeg xfade transition type
 */
function getWipeType(direction: string): string {
  switch (direction) {
    case 'left':
      return 'wipeleft';
    case 'right':
      return 'wiperight';
    case 'up':
      return 'wipeup';
    case 'down':
      return 'wipedown';
    case 'radial':
      return 'circleopen';
    default:
      return 'wipeleft';
  }
}

/**
 * Map slide direction to FFmpeg xfade transition type
 */
function getSlideType(direction: string): string {
  switch (direction) {
    case 'left':
      return 'slideleft';
    case 'right':
      return 'slideright';
    case 'up':
      return 'slideup';
    case 'down':
      return 'slidedown';
    default:
      return 'slideleft';
  }
}

/**
 * Build audio filter chain
 */
function buildAudioFilterChain(timeline: Timeline): {
  filters: string[];
  output: string;
} {
  const filters: string[] = [];
  const audioTracks = timeline.tracks.filter(
    (t) => t.type !== 'video' && t.clips.length > 0,
  );

  if (audioTracks.length === 0) {
    // Generate silent audio
    const duration = timeline.duration;
    filters.push(`anullsrc=r=48000:cl=stereo,atrim=0:${duration}[aout]`);
    return { filters, output: 'aout' };
  }

  // Mix audio tracks with volume adjustments
  const audioInputs: string[] = [];
  let inputIndex = 0;

  for (const track of audioTracks) {
    if (track.isMuted) continue;

    for (const clip of track.clips) {
      if (clip.isPlaceholder) continue;

      // Apply volume and fade
      let clipFilter = `[${inputIndex}:a]`;
      const filterParts: string[] = [];

      // Volume adjustment
      const volume = (clip.volume ?? 1) * (track.volume ?? 1);
      if (volume !== 1) {
        filterParts.push(`volume=${volume}`);
      }

      // Fade in
      if (clip.fadeIn && clip.fadeIn > 0) {
        filterParts.push(`afade=t=in:d=${clip.fadeIn}`);
      }

      // Fade out
      if (clip.fadeOut && clip.fadeOut > 0) {
        filterParts.push(
          `afade=t=out:st=${clip.duration - clip.fadeOut}:d=${clip.fadeOut}`,
        );
      }

      // Delay to position on timeline
      if (clip.startTime > 0) {
        filterParts.push(
          `adelay=${clip.startTime * 1000}|${clip.startTime * 1000}`,
        );
      }

      if (filterParts.length > 0) {
        clipFilter += filterParts.join(',') + `[a${inputIndex}]`;
        filters.push(clipFilter);
        audioInputs.push(`a${inputIndex}`);
      } else {
        audioInputs.push(`${inputIndex}:a`);
      }

      inputIndex++;
    }
  }

  // Mix all audio tracks
  if (audioInputs.length === 0) {
    const duration = timeline.duration;
    filters.push(`anullsrc=r=48000:cl=stereo,atrim=0:${duration}[aout]`);
    return { filters, output: 'aout' };
  }

  if (audioInputs.length === 1) {
    return { filters, output: audioInputs[0] ?? 'aout' };
  }

  const mixInputs = audioInputs.map((i) => `[${i}]`).join('');
  filters.push(
    `${mixInputs}amix=inputs=${audioInputs.length}:normalize=0[aout]`,
  );

  return { filters, output: 'aout' };
}

/**
 * Build output options based on render settings
 */
function buildOutputOptions(
  settings: RenderSettings,
  isReencoding: boolean,
): string[] {
  const options: string[] = [];

  if (isReencoding) {
    // Video codec
    switch (settings.codec) {
      case 'h264':
        options.push('-c:v', 'libx264');
        options.push(
          '-preset',
          settings.quality === 'draft' ? 'ultrafast' : 'medium',
        );
        break;
      case 'h265':
        options.push('-c:v', 'libx265');
        options.push(
          '-preset',
          settings.quality === 'draft' ? 'ultrafast' : 'medium',
        );
        break;
      case 'vp9':
        options.push('-c:v', 'libvpx-vp9');
        break;
      case 'prores':
        options.push('-c:v', 'prores_ks');
        options.push('-profile:v', '3'); // ProRes HQ
        break;
    }

    // CRF or bitrate
    if (settings.crf !== undefined) {
      options.push('-crf', settings.crf.toString());
    } else if (settings.videoBitrate) {
      options.push('-b:v', `${settings.videoBitrate}k`);
    }

    // Audio codec
    if (settings.includeAudio) {
      switch (settings.audioCodec) {
        case 'aac':
          options.push('-c:a', 'aac');
          break;
        case 'mp3':
          options.push('-c:a', 'libmp3lame');
          break;
        case 'opus':
          options.push('-c:a', 'libopus');
          break;
        case 'pcm':
          options.push('-c:a', 'pcm_s16le');
          break;
      }
      options.push('-b:a', `${settings.audioBitrate}k`);
      options.push('-ar', settings.sampleRate.toString());
    } else {
      options.push('-an');
    }

    // Map filter outputs
    options.push('-map', '[outv]');
    if (settings.includeAudio) {
      options.push('-map', '[outa]');
    }
  }

  // Pixel format for compatibility
  options.push('-pix_fmt', 'yuv420p');

  // Faststart for web playback
  if (settings.format === 'mp4') {
    options.push('-movflags', '+faststart');
  }

  return options;
}

/**
 * Get video clips from timeline
 */
function getVideoClips(timeline: Timeline): Clip[] {
  const videoTrack = timeline.tracks.find((t) => t.type === 'video');
  if (!videoTrack) return [];
  return [...videoTrack.clips]
    .filter((c) => !c.isPlaceholder)
    .sort((a, b) => a.startTime - b.startTime);
}

/**
 * Get audio clips from timeline
 */
function getAudioClips(timeline: Timeline): Clip[] {
  const audioTracks = timeline.tracks.filter((t) => t.type !== 'video');
  return audioTracks
    .flatMap((t) => t.clips)
    .filter((c) => !c.isPlaceholder)
    .sort((a, b) => a.startTime - b.startTime);
}

/**
 * Check if timeline has audio tracks
 */
function hasAudioTracks(timeline: Timeline): boolean {
  return timeline.tracks.some(
    (t) => t.type !== 'video' && t.clips.length > 0 && !t.isMuted,
  );
}
