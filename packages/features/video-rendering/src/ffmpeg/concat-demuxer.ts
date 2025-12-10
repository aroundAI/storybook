/**
 * FFmpeg Concat Demuxer
 *
 * Implements the concat demuxer approach for stitching videos without re-encoding.
 * This is the fastest approach but only works when:
 * - All clips have the same codec, resolution, and framerate
 * - No transitions are needed between clips
 *
 * @see https://trac.ffmpeg.org/wiki/Concatenate
 */
import type { Clip } from '../schema/timeline';

// ============================================================================
// Types
// ============================================================================

export interface ConcatDemuxerEntry {
  /** File path or URL */
  file: string;

  /** Duration in seconds (optional, for verification) */
  duration?: number;

  /** Inpoint for trimming (in seconds) */
  inpoint?: number;

  /** Outpoint for trimming (in seconds) */
  outpoint?: number;
}

export interface ConcatDemuxerOptions {
  /** Include duration metadata */
  includeDuration?: boolean;

  /** Safe mode (only allow absolute paths) */
  safeMode?: boolean;
}

// ============================================================================
// Concat Demuxer Functions
// ============================================================================

/**
 * Generate concat demuxer file content from clips
 *
 * @example
 * ```
 * ffconcat version 1.0
 *
 * file '/path/to/video1.mp4'
 * duration 5.0
 * inpoint 0
 * outpoint 5.0
 *
 * file '/path/to/video2.mp4'
 * duration 8.0
 * ```
 */
export function generateConcatDemuxerContent(
  clips: Clip[],
  options: ConcatDemuxerOptions = {},
): string {
  const lines: string[] = ['ffconcat version 1.0', ''];

  for (const clip of clips) {
    if (clip.isPlaceholder) continue;

    // File path (escape single quotes)
    const filePath = escapeFilePath(clip.assetUrl);
    lines.push(`file '${filePath}'`);

    // Duration
    if (options.includeDuration) {
      lines.push(`duration ${clip.duration}`);
    }

    // Inpoint (trim start)
    if (clip.sourceStart !== undefined && clip.sourceStart > 0) {
      lines.push(`inpoint ${clip.sourceStart}`);
    }

    // Outpoint (trim end)
    if (clip.sourceEnd !== undefined) {
      lines.push(`outpoint ${clip.sourceEnd}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Generate concat demuxer entries from clips
 */
export function generateConcatEntries(clips: Clip[]): ConcatDemuxerEntry[] {
  return clips
    .filter((clip) => !clip.isPlaceholder)
    .map((clip) => ({
      file: clip.assetUrl,
      duration: clip.duration,
      inpoint: clip.sourceStart,
      outpoint: clip.sourceEnd,
    }));
}

/**
 * Build FFmpeg command for concat demuxer
 */
export function buildConcatDemuxerArgs(
  concatFilePath: string,
  outputPath: string,
  options: {
    copyCodec?: boolean;
    hwaccel?: string;
  } = {},
): string[] {
  const args: string[] = [
    '-y', // Overwrite output
    '-hide_banner',
  ];

  // Hardware acceleration
  if (options.hwaccel) {
    args.push('-hwaccel', options.hwaccel);
  }

  // Input with concat demuxer
  args.push(
    '-f',
    'concat',
    '-safe',
    '0', // Allow any file paths
    '-i',
    concatFilePath,
  );

  // Copy codecs (no re-encoding)
  if (options.copyCodec !== false) {
    args.push('-c', 'copy');
  }

  // Output
  args.push(outputPath);

  return args;
}

/**
 * Check if clips are compatible for concat demuxer (same format)
 * In practice, this would need to probe each file with ffprobe
 */
export function areClipsCompatible(clips: Clip[]): {
  compatible: boolean;
  reason?: string;
} {
  if (clips.length === 0) {
    return { compatible: false, reason: 'No clips provided' };
  }

  if (clips.length === 1) {
    return { compatible: true };
  }

  // Check for placeholder clips
  const nonPlaceholderClips = clips.filter((c) => !c.isPlaceholder);
  if (nonPlaceholderClips.length === 0) {
    return { compatible: false, reason: 'All clips are placeholders' };
  }

  // Check for URL protocol consistency
  const protocols = new Set(
    nonPlaceholderClips.map((c) => getProtocol(c.assetUrl)),
  );
  if (protocols.size > 1) {
    return {
      compatible: false,
      reason: 'Mixed URL protocols (local/remote)',
    };
  }

  // For a real implementation, we would probe each file with ffprobe
  // to check codec, resolution, framerate, etc.
  // For now, assume compatible if same source domain
  return { compatible: true };
}

/**
 * Validate concat demuxer content
 */
export function validateConcatContent(content: string): {
  valid: boolean;
  errors: string[];
  entries: number;
} {
  const errors: string[] = [];
  let entries = 0;

  const lines = content.split('\n');

  // Check header
  if (!lines[0]?.includes('ffconcat version 1.0')) {
    errors.push('Missing or invalid ffconcat header');
  }

  // Parse entries
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? '';

    if (line.startsWith('file ')) {
      entries++;

      // Validate file path format
      const match = line.match(/^file '(.+)'$/);
      if (!match) {
        const altMatch = line.match(/^file (.+)$/);
        if (!altMatch) {
          errors.push(`Invalid file entry at line ${i + 1}: ${line}`);
        }
      }
    } else if (line.startsWith('duration ')) {
      const duration = parseFloat(line.slice(9));
      if (isNaN(duration) || duration < 0) {
        errors.push(`Invalid duration at line ${i + 1}: ${line}`);
      }
    } else if (line.startsWith('inpoint ')) {
      const inpoint = parseFloat(line.slice(8));
      if (isNaN(inpoint) || inpoint < 0) {
        errors.push(`Invalid inpoint at line ${i + 1}: ${line}`);
      }
    } else if (line.startsWith('outpoint ')) {
      const outpoint = parseFloat(line.slice(9));
      if (isNaN(outpoint) || outpoint < 0) {
        errors.push(`Invalid outpoint at line ${i + 1}: ${line}`);
      }
    } else if (line !== '' && !line.startsWith('#')) {
      // Unknown directive (warning, not error)
    }
  }

  return {
    valid: errors.length === 0 && entries > 0,
    errors,
    entries,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Escape file path for concat demuxer
 */
function escapeFilePath(path: string): string {
  // Escape single quotes by replacing with '\''
  return path.replace(/'/g, "'\\''");
}

/**
 * Get URL protocol
 */
function getProtocol(url: string): string {
  if (url.startsWith('http://')) return 'http';
  if (url.startsWith('https://')) return 'https';
  if (url.startsWith('file://')) return 'file';
  if (url.startsWith('/')) return 'local';
  return 'unknown';
}

/**
 * Calculate total duration from concat entries
 */
export function calculateTotalDuration(entries: ConcatDemuxerEntry[]): number {
  return entries.reduce((total, entry) => {
    if (entry.duration !== undefined) {
      return total + entry.duration;
    }
    if (entry.inpoint !== undefined && entry.outpoint !== undefined) {
      return total + (entry.outpoint - entry.inpoint);
    }
    return total;
  }, 0);
}

/**
 * Estimate output file size based on entries and bitrate
 */
export function estimateOutputSize(
  entries: ConcatDemuxerEntry[],
  videoBitrate: number, // kbps
  audioBitrate: number, // kbps
): number {
  const totalDuration = calculateTotalDuration(entries);
  const totalBitrate = videoBitrate + audioBitrate; // kbps
  const sizeKB = (totalBitrate * totalDuration) / 8;
  return Math.ceil(sizeKB * 1024); // bytes
}
