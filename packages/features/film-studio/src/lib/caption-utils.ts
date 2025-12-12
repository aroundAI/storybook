import type { CaptionSegment, CaptionWord } from './schemas/caption.schema';

/**
 * Format time for SRT format (HH:MM:SS,mmm)
 * SRT uses comma as decimal separator
 */
export function formatSrtTime(seconds: number): string {
  // Round to nearest millisecond first to handle edge cases like 1.9999 -> 2.000
  const totalMs = Math.round(seconds * 1000);
  const totalSecs = Math.floor(totalMs / 1000);

  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  const ms = totalMs % 1000;

  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

/**
 * Format time for VTT format (HH:MM:SS.mmm)
 * VTT uses period as decimal separator
 */
export function formatVttTime(seconds: number): string {
  // Round to nearest millisecond first to handle edge cases like 1.9999 -> 2.000
  const totalMs = Math.round(seconds * 1000);
  const totalSecs = Math.floor(totalMs / 1000);

  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  const ms = totalMs % 1000;

  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

/**
 * Format seconds to display time (MM:SS)
 * For UI display purposes
 */
export function formatDisplayTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Export captions to SRT format
 *
 * SRT format:
 * 1
 * 00:00:00,000 --> 00:00:02,500
 * Hello world
 *
 * 2
 * 00:00:03,000 --> 00:00:05,000
 * How are you?
 */
export function exportToSrt(segments: CaptionSegment[]): string {
  return segments
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
    .map((segment, index) => {
      const lines = [
        (index + 1).toString(),
        `${formatSrtTime(segment.startTime)} --> ${formatSrtTime(segment.endTime)}`,
        segment.text,
        '',
      ];
      return lines.join('\n');
    })
    .join('\n');
}

/**
 * Export captions to WebVTT format
 *
 * VTT format:
 * WEBVTT
 *
 * 1
 * 00:00:00.000 --> 00:00:02.500
 * Hello world
 *
 * 2
 * 00:00:03.000 --> 00:00:05.000
 * How are you?
 */
export function exportToVtt(segments: CaptionSegment[]): string {
  const header = 'WEBVTT\n\n';
  const body = segments
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
    .map((segment, index) => {
      const lines = [
        (index + 1).toString(),
        `${formatVttTime(segment.startTime)} --> ${formatVttTime(segment.endTime)}`,
        segment.text,
        '',
      ];
      return lines.join('\n');
    })
    .join('\n');

  return header + body;
}

/**
 * Parse SRT time string to seconds
 */
export function parseSrtTime(timeStr: string): number {
  const [time, msStr] = timeStr.split(',');
  const [hrs, mins, secs] = time.split(':').map(Number);
  const ms = parseInt(msStr, 10);
  return hrs * 3600 + mins * 60 + secs + ms / 1000;
}

/**
 * Parse VTT time string to seconds
 */
export function parseVttTime(timeStr: string): number {
  const [time, msStr] = timeStr.split('.');
  const parts = time.split(':').map(Number);

  // VTT can have HH:MM:SS or MM:SS format
  let hrs = 0;
  let mins = 0;
  let secs = 0;

  if (parts.length === 3) {
    [hrs, mins, secs] = parts;
  } else if (parts.length === 2) {
    [mins, secs] = parts;
  }

  const ms = parseInt(msStr, 10);
  return hrs * 3600 + mins * 60 + secs + ms / 1000;
}

/**
 * Parse SRT file content to caption segments
 */
export function parseSrt(content: string): CaptionSegment[] {
  const blocks = content.trim().split(/\n\n+/);
  const segments: CaptionSegment[] = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length < 3) continue;

    const seqNum = parseInt(lines[0], 10);
    if (isNaN(seqNum)) continue;

    const timeMatch = lines[1].match(
      /(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/,
    );

    if (!timeMatch) continue;

    const text = lines.slice(2).join('\n').trim();

    segments.push({
      sequenceNumber: seqNum,
      startTime: parseSrtTime(timeMatch[1]),
      endTime: parseSrtTime(timeMatch[2]),
      text,
    });
  }

  return segments;
}

/**
 * Parse VTT file content to caption segments
 */
export function parseVtt(content: string): CaptionSegment[] {
  // Remove WEBVTT header and any metadata
  const lines = content.split('\n');
  const startIndex = lines.findIndex((line) => line.includes('-->'));
  if (startIndex === -1) return [];

  // Find cue index (line before the timestamp)
  const cueStart = startIndex > 0 ? startIndex - 1 : startIndex;

  const blocks = lines.slice(cueStart).join('\n').trim().split(/\n\n+/);
  const segments: CaptionSegment[] = [];

  for (const block of blocks) {
    const blockLines = block.split('\n');
    if (blockLines.length < 2) continue;

    // Find timestamp line
    const timestampIndex = blockLines.findIndex((line) => line.includes('-->'));
    if (timestampIndex === -1) continue;

    const timeMatch = blockLines[timestampIndex].match(
      /(\d{2}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3})/,
    );

    if (!timeMatch) continue;

    // Get sequence number if available
    let seqNum = segments.length + 1;
    if (timestampIndex > 0) {
      const potentialSeq = parseInt(blockLines[timestampIndex - 1], 10);
      if (!isNaN(potentialSeq)) {
        seqNum = potentialSeq;
      }
    }

    const text = blockLines
      .slice(timestampIndex + 1)
      .join('\n')
      .trim();

    segments.push({
      sequenceNumber: seqNum,
      startTime: parseVttTime(timeMatch[1]),
      endTime: parseVttTime(timeMatch[2]),
      text,
    });
  }

  return segments;
}

/**
 * Merge consecutive segments with the same speaker
 * Useful for creating more natural caption groupings
 */
export function mergeSegments(
  segments: CaptionSegment[],
  options: {
    maxDuration?: number;
    maxGap?: number;
  } = {},
): CaptionSegment[] {
  const { maxDuration = 5, maxGap = 0.5 } = options;

  if (segments.length === 0) return [];

  const sorted = [...segments].sort(
    (a, b) => a.sequenceNumber - b.sequenceNumber,
  );
  const merged: CaptionSegment[] = [];
  let current = { ...sorted[0] };

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    const gap = next.startTime - current.endTime;
    const combinedDuration = next.endTime - current.startTime;

    const canMerge =
      current.speakerId === next.speakerId &&
      gap < maxGap &&
      combinedDuration <= maxDuration;

    if (canMerge) {
      // Merge segments
      current.endTime = next.endTime;
      current.text = `${current.text} ${next.text}`;

      // Merge words if both have them
      if (current.words && next.words) {
        current.words = [...current.words, ...next.words];
      } else {
        current.words = undefined;
      }
    } else {
      merged.push(current);
      current = { ...next, sequenceNumber: merged.length + 1 };
    }
  }

  merged.push(current);

  // Renumber sequence numbers
  return merged.map((seg, idx) => ({
    ...seg,
    sequenceNumber: idx + 1,
  }));
}

/**
 * Split a segment at a specified time
 */
export function splitSegment(
  segment: CaptionSegment,
  splitTime: number,
): [CaptionSegment, CaptionSegment] {
  if (splitTime <= segment.startTime || splitTime >= segment.endTime) {
    throw new Error('Split time must be within segment boundaries');
  }

  const words = segment.words ?? [];
  const beforeWords: CaptionWord[] = [];
  const afterWords: CaptionWord[] = [];

  // Split words based on timing
  for (const word of words) {
    if (word.end <= splitTime) {
      beforeWords.push(word);
    } else if (word.start >= splitTime) {
      afterWords.push(word);
    } else {
      // Word spans the split point - assign based on majority
      if ((word.start + word.end) / 2 < splitTime) {
        beforeWords.push(word);
      } else {
        afterWords.push(word);
      }
    }
  }

  // Generate text from words or split the text
  let beforeText: string;
  let afterText: string;

  if (beforeWords.length > 0 && afterWords.length > 0) {
    beforeText = beforeWords.map((w) => w.word).join(' ');
    afterText = afterWords.map((w) => w.word).join(' ');
  } else {
    // Fallback: split text roughly in half based on timing ratio
    const ratio =
      (splitTime - segment.startTime) / (segment.endTime - segment.startTime);
    const splitIndex = Math.floor(segment.text.length * ratio);

    // Try to split at a word boundary
    const spaceIndex = segment.text.indexOf(' ', splitIndex);
    const actualSplitIndex = spaceIndex > 0 ? spaceIndex : splitIndex;

    beforeText = segment.text.substring(0, actualSplitIndex).trim();
    afterText = segment.text.substring(actualSplitIndex).trim();
  }

  const firstSegment: CaptionSegment = {
    ...segment,
    endTime: splitTime,
    text: beforeText,
    words: beforeWords.length > 0 ? beforeWords : undefined,
  };

  const secondSegment: CaptionSegment = {
    id: undefined, // New segment needs new ID
    captionId: segment.captionId,
    startTime: splitTime,
    endTime: segment.endTime,
    text: afterText,
    words: afterWords.length > 0 ? afterWords : undefined,
    speakerId: segment.speakerId,
    sequenceNumber: segment.sequenceNumber + 1,
    isEdited: true,
  };

  return [firstSegment, secondSegment];
}

/**
 * Calculate total duration from segments
 */
export function calculateTotalDuration(segments: CaptionSegment[]): number {
  if (segments.length === 0) return 0;

  const sorted = [...segments].sort((a, b) => a.endTime - b.endTime);
  return sorted[sorted.length - 1].endTime;
}

/**
 * Find the active segment for a given time
 */
export function findActiveSegment(
  segments: CaptionSegment[],
  currentTime: number,
): CaptionSegment | undefined {
  return segments.find(
    (seg) => currentTime >= seg.startTime && currentTime < seg.endTime,
  );
}

/**
 * Validate segments for overlaps and gaps
 */
export function validateSegments(segments: CaptionSegment[]): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  const sorted = [...segments].sort(
    (a, b) => a.sequenceNumber - b.sequenceNumber,
  );

  for (let i = 0; i < sorted.length; i++) {
    const segment = sorted[i];

    // Check for invalid timing
    if (segment.endTime <= segment.startTime) {
      errors.push(
        `Segment ${segment.sequenceNumber}: End time must be after start time`,
      );
    }

    // Check for negative times
    if (segment.startTime < 0) {
      errors.push(
        `Segment ${segment.sequenceNumber}: Start time cannot be negative`,
      );
    }

    // Check for empty text
    if (!segment.text.trim()) {
      errors.push(`Segment ${segment.sequenceNumber}: Text cannot be empty`);
    }

    // Check for overlaps with next segment
    if (i < sorted.length - 1) {
      const next = sorted[i + 1];
      if (segment.endTime > next.startTime) {
        warnings.push(
          `Segments ${segment.sequenceNumber} and ${next.sequenceNumber} overlap`,
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Language names for display
 */
export const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  ar: 'Arabic',
  hi: 'Hindi',
  ru: 'Russian',
};

/**
 * Get display name for a language code
 */
export function getLanguageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code.toUpperCase();
}
