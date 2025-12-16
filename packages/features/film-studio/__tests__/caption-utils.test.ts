import { describe, expect, it } from 'vitest';

import {
  LANGUAGE_NAMES,
  calculateTotalDuration,
  exportToSrt,
  exportToVtt,
  findActiveSegment,
  formatDisplayTime,
  formatSrtTime,
  formatVttTime,
  getLanguageName,
  mergeSegments,
  parseSrt,
  parseSrtTime,
  parseVtt,
  parseVttTime,
  splitSegment,
  validateSegments,
} from '../src/lib/caption-utils';
import type { CaptionSegment } from '../src/lib/schemas/caption.schema';

describe('caption-utils', () => {
  describe('formatSrtTime', () => {
    it('should format seconds to SRT time format (HH:MM:SS,mmm)', () => {
      expect(formatSrtTime(0)).toBe('00:00:00,000');
      expect(formatSrtTime(1)).toBe('00:00:01,000');
      expect(formatSrtTime(61)).toBe('00:01:01,000');
      expect(formatSrtTime(3661)).toBe('01:01:01,000');
    });

    it('should handle milliseconds correctly', () => {
      expect(formatSrtTime(1.5)).toBe('00:00:01,500');
      expect(formatSrtTime(1.123)).toBe('00:00:01,123');
      expect(formatSrtTime(1.999)).toBe('00:00:01,999');
    });

    it('should handle fractional seconds with rounding', () => {
      expect(formatSrtTime(1.9999)).toBe('00:00:02,000');
    });

    it('should format hours correctly', () => {
      expect(formatSrtTime(7200)).toBe('02:00:00,000');
      expect(formatSrtTime(7325.75)).toBe('02:02:05,750');
    });
  });

  describe('formatVttTime', () => {
    it('should format seconds to VTT time format (HH:MM:SS.mmm)', () => {
      expect(formatVttTime(0)).toBe('00:00:00.000');
      expect(formatVttTime(1)).toBe('00:00:01.000');
      expect(formatVttTime(61)).toBe('00:01:01.000');
      expect(formatVttTime(3661)).toBe('01:01:01.000');
    });

    it('should use period as decimal separator (not comma)', () => {
      expect(formatVttTime(1.5)).toBe('00:00:01.500');
      expect(formatVttTime(1.123)).toBe('00:00:01.123');
    });
  });

  describe('formatDisplayTime', () => {
    it('should format seconds to MM:SS display format', () => {
      expect(formatDisplayTime(0)).toBe('00:00');
      expect(formatDisplayTime(30)).toBe('00:30');
      expect(formatDisplayTime(60)).toBe('01:00');
      expect(formatDisplayTime(90)).toBe('01:30');
      expect(formatDisplayTime(3600)).toBe('60:00');
    });

    it('should truncate fractional seconds', () => {
      expect(formatDisplayTime(30.9)).toBe('00:30');
      expect(formatDisplayTime(59.99)).toBe('00:59');
    });
  });

  describe('parseSrtTime', () => {
    it('should parse SRT time format to seconds', () => {
      expect(parseSrtTime('00:00:00,000')).toBe(0);
      expect(parseSrtTime('00:00:01,000')).toBe(1);
      expect(parseSrtTime('00:01:00,000')).toBe(60);
      expect(parseSrtTime('01:00:00,000')).toBe(3600);
    });

    it('should handle milliseconds', () => {
      expect(parseSrtTime('00:00:01,500')).toBe(1.5);
      expect(parseSrtTime('00:00:01,123')).toBeCloseTo(1.123, 2);
    });
  });

  describe('parseVttTime', () => {
    it('should parse VTT time format (HH:MM:SS.mmm) to seconds', () => {
      expect(parseVttTime('00:00:00.000')).toBe(0);
      expect(parseVttTime('00:00:01.000')).toBe(1);
      expect(parseVttTime('00:01:00.000')).toBe(60);
      expect(parseVttTime('01:00:00.000')).toBe(3600);
    });

    it('should parse VTT time format (MM:SS.mmm) to seconds', () => {
      expect(parseVttTime('00:01.000')).toBe(1);
      expect(parseVttTime('01:30.500')).toBe(90.5);
    });

    it('should handle milliseconds', () => {
      expect(parseVttTime('00:00:01.500')).toBe(1.5);
      expect(parseVttTime('00:00:01.123')).toBeCloseTo(1.123, 2);
    });
  });

  describe('exportToSrt', () => {
    it('should export segments to valid SRT format', () => {
      const segments: CaptionSegment[] = [
        { sequenceNumber: 1, startTime: 0, endTime: 2.5, text: 'Hello world' },
        { sequenceNumber: 2, startTime: 3, endTime: 5, text: 'How are you?' },
      ];

      const result = exportToSrt(segments);

      expect(result).toContain('1\n00:00:00,000 --> 00:00:02,500\nHello world');
      expect(result).toContain(
        '2\n00:00:03,000 --> 00:00:05,000\nHow are you?',
      );
    });

    it('should sort segments by sequence number', () => {
      const segments: CaptionSegment[] = [
        { sequenceNumber: 2, startTime: 3, endTime: 5, text: 'Second' },
        { sequenceNumber: 1, startTime: 0, endTime: 2, text: 'First' },
      ];

      const result = exportToSrt(segments);
      const lines = result.split('\n');

      // First segment should come first in output
      expect(lines[0]).toBe('1');
      expect(lines[2]).toBe('First');
    });

    it('should handle empty segments', () => {
      const result = exportToSrt([]);
      expect(result).toBe('');
    });
  });

  describe('exportToVtt', () => {
    it('should export segments to valid VTT format with WEBVTT header', () => {
      const segments: CaptionSegment[] = [
        { sequenceNumber: 1, startTime: 0, endTime: 2.5, text: 'Hello world' },
      ];

      const result = exportToVtt(segments);

      expect(result).toMatch(/^WEBVTT\n\n/);
      expect(result).toContain('00:00:00.000 --> 00:00:02.500');
      expect(result).toContain('Hello world');
    });

    it('should use period as decimal separator', () => {
      const segments: CaptionSegment[] = [
        { sequenceNumber: 1, startTime: 1.5, endTime: 3.25, text: 'Test' },
      ];

      const result = exportToVtt(segments);

      expect(result).toContain('.500');
      expect(result).toContain('.250');
      expect(result).not.toContain(',');
    });
  });

  describe('parseSrt', () => {
    it('should parse valid SRT content to segments', () => {
      const srtContent = `1
00:00:00,000 --> 00:00:02,500
Hello world

2
00:00:03,000 --> 00:00:05,000
How are you?`;

      const segments = parseSrt(srtContent);

      expect(segments).toHaveLength(2);
      expect(segments[0]).toMatchObject({
        sequenceNumber: 1,
        startTime: 0,
        endTime: 2.5,
        text: 'Hello world',
      });
      expect(segments[1]).toMatchObject({
        sequenceNumber: 2,
        startTime: 3,
        endTime: 5,
        text: 'How are you?',
      });
    });

    it('should handle multiline text', () => {
      const srtContent = `1
00:00:00,000 --> 00:00:02,500
First line
Second line`;

      const segments = parseSrt(srtContent);

      expect(segments[0]?.text).toBe('First line\nSecond line');
    });

    it('should handle empty content', () => {
      const segments = parseSrt('');
      expect(segments).toHaveLength(0);
    });

    it('should skip invalid blocks', () => {
      const srtContent = `invalid
00:00:00,000 --> 00:00:02,500
Text

1
00:00:03,000 --> 00:00:05,000
Valid`;

      const segments = parseSrt(srtContent);
      expect(segments).toHaveLength(1);
      expect(segments[0]?.text).toBe('Valid');
    });
  });

  describe('parseVtt', () => {
    it('should parse valid VTT content to segments', () => {
      const vttContent = `WEBVTT

1
00:00:00.000 --> 00:00:02.500
Hello world

2
00:00:03.000 --> 00:00:05.000
How are you?`;

      const segments = parseVtt(vttContent);

      expect(segments).toHaveLength(2);
      expect(segments[0]).toMatchObject({
        sequenceNumber: 1,
        startTime: 0,
        endTime: 2.5,
        text: 'Hello world',
      });
    });

    it('should handle VTT without sequence numbers', () => {
      const vttContent = `WEBVTT

00:00:00.000 --> 00:00:02.500
Hello world

00:00:03.000 --> 00:00:05.000
How are you?`;

      const segments = parseVtt(vttContent);

      expect(segments).toHaveLength(2);
      expect(segments[0]?.sequenceNumber).toBe(1);
      expect(segments[1]?.sequenceNumber).toBe(2);
    });

    it('should handle MM:SS.mmm format', () => {
      const vttContent = `WEBVTT

00:01.000 --> 00:03.500
Short format`;

      const segments = parseVtt(vttContent);

      expect(segments).toHaveLength(1);
      expect(segments[0]?.startTime).toBe(1);
      expect(segments[0]?.endTime).toBe(3.5);
    });

    it('should return empty array for content without timestamps', () => {
      const vttContent = `WEBVTT

This is not valid VTT content`;

      const segments = parseVtt(vttContent);
      expect(segments).toHaveLength(0);
    });
  });

  describe('mergeSegments', () => {
    it('should merge consecutive segments with same speaker', () => {
      const segments: CaptionSegment[] = [
        {
          sequenceNumber: 1,
          startTime: 0,
          endTime: 1,
          text: 'Hello',
          speakerId: 'speaker-1',
        },
        {
          sequenceNumber: 2,
          startTime: 1.2,
          endTime: 2,
          text: 'world',
          speakerId: 'speaker-1',
        },
      ];

      const merged = mergeSegments(segments, { maxGap: 0.5, maxDuration: 10 });

      expect(merged).toHaveLength(1);
      expect(merged[0]?.text).toBe('Hello world');
      expect(merged[0]?.startTime).toBe(0);
      expect(merged[0]?.endTime).toBe(2);
    });

    it('should not merge segments with different speakers', () => {
      const segments: CaptionSegment[] = [
        {
          sequenceNumber: 1,
          startTime: 0,
          endTime: 1,
          text: 'Hello',
          speakerId: 'speaker-1',
        },
        {
          sequenceNumber: 2,
          startTime: 1.2,
          endTime: 2,
          text: 'world',
          speakerId: 'speaker-2',
        },
      ];

      const merged = mergeSegments(segments);

      expect(merged).toHaveLength(2);
    });

    it('should not merge segments with gap exceeding maxGap', () => {
      const segments: CaptionSegment[] = [
        {
          sequenceNumber: 1,
          startTime: 0,
          endTime: 1,
          text: 'Hello',
          speakerId: 'speaker-1',
        },
        {
          sequenceNumber: 2,
          startTime: 2,
          endTime: 3,
          text: 'world',
          speakerId: 'speaker-1',
        },
      ];

      const merged = mergeSegments(segments, { maxGap: 0.5 });

      expect(merged).toHaveLength(2);
    });

    it('should not merge if combined duration exceeds maxDuration', () => {
      const segments: CaptionSegment[] = [
        {
          sequenceNumber: 1,
          startTime: 0,
          endTime: 3,
          text: 'Long segment one',
          speakerId: 'speaker-1',
        },
        {
          sequenceNumber: 2,
          startTime: 3.2,
          endTime: 6,
          text: 'Long segment two',
          speakerId: 'speaker-1',
        },
      ];

      const merged = mergeSegments(segments, { maxDuration: 5 });

      expect(merged).toHaveLength(2);
    });

    it('should renumber sequence numbers after merging', () => {
      const segments: CaptionSegment[] = [
        {
          sequenceNumber: 5,
          startTime: 0,
          endTime: 1,
          text: 'A',
          speakerId: 'speaker-1',
        },
        {
          sequenceNumber: 10,
          startTime: 1.2,
          endTime: 2,
          text: 'B',
          speakerId: 'speaker-1',
        },
        {
          sequenceNumber: 15,
          startTime: 3,
          endTime: 4,
          text: 'C',
          speakerId: 'speaker-2',
        },
      ];

      const merged = mergeSegments(segments, { maxGap: 0.5 });

      expect(merged).toHaveLength(2);
      expect(merged[0]?.sequenceNumber).toBe(1);
      expect(merged[1]?.sequenceNumber).toBe(2);
    });

    it('should handle empty segments', () => {
      const merged = mergeSegments([]);
      expect(merged).toHaveLength(0);
    });
  });

  describe('splitSegment', () => {
    it('should split segment at specified time', () => {
      const segment: CaptionSegment = {
        id: 'seg-1',
        captionId: 'cap-1',
        sequenceNumber: 1,
        startTime: 0,
        endTime: 4,
        text: 'Hello world how are you',
        speakerId: 'speaker-1',
      };

      const [first, second] = splitSegment(segment, 2);

      expect(first.startTime).toBe(0);
      expect(first.endTime).toBe(2);
      expect(second.startTime).toBe(2);
      expect(second.endTime).toBe(4);
    });

    it('should preserve segment properties', () => {
      const segment: CaptionSegment = {
        id: 'seg-1',
        captionId: 'cap-1',
        sequenceNumber: 1,
        startTime: 0,
        endTime: 4,
        text: 'Hello world',
        speakerId: 'speaker-1',
      };

      const [first, second] = splitSegment(segment, 2);

      expect(first.id).toBe('seg-1');
      expect(first.captionId).toBe('cap-1');
      expect(first.speakerId).toBe('speaker-1');
      expect(second.captionId).toBe('cap-1');
      expect(second.speakerId).toBe('speaker-1');
      expect(second.isEdited).toBe(true);
    });

    it('should split using word timing when available', () => {
      const segment: CaptionSegment = {
        sequenceNumber: 1,
        startTime: 0,
        endTime: 4,
        text: 'Hello world',
        words: [
          { word: 'Hello', start: 0, end: 1 },
          { word: 'world', start: 2, end: 4 },
        ],
      };

      const [first, second] = splitSegment(segment, 1.5);

      expect(first.text).toBe('Hello');
      expect(second.text).toBe('world');
    });

    it('should throw error if split time is outside segment boundaries', () => {
      const segment: CaptionSegment = {
        sequenceNumber: 1,
        startTime: 1,
        endTime: 3,
        text: 'Test',
      };

      expect(() => splitSegment(segment, 0)).toThrow();
      expect(() => splitSegment(segment, 3)).toThrow();
      expect(() => splitSegment(segment, 4)).toThrow();
    });
  });

  describe('calculateTotalDuration', () => {
    it('should return end time of last segment', () => {
      const segments: CaptionSegment[] = [
        { sequenceNumber: 1, startTime: 0, endTime: 5, text: 'A' },
        { sequenceNumber: 2, startTime: 5, endTime: 10, text: 'B' },
        { sequenceNumber: 3, startTime: 10, endTime: 15, text: 'C' },
      ];

      expect(calculateTotalDuration(segments)).toBe(15);
    });

    it('should handle unsorted segments', () => {
      const segments: CaptionSegment[] = [
        { sequenceNumber: 3, startTime: 10, endTime: 15, text: 'C' },
        { sequenceNumber: 1, startTime: 0, endTime: 5, text: 'A' },
        { sequenceNumber: 2, startTime: 5, endTime: 10, text: 'B' },
      ];

      expect(calculateTotalDuration(segments)).toBe(15);
    });

    it('should return 0 for empty segments', () => {
      expect(calculateTotalDuration([])).toBe(0);
    });
  });

  describe('findActiveSegment', () => {
    const segments: CaptionSegment[] = [
      { sequenceNumber: 1, startTime: 0, endTime: 5, text: 'A' },
      { sequenceNumber: 2, startTime: 5, endTime: 10, text: 'B' },
      { sequenceNumber: 3, startTime: 10, endTime: 15, text: 'C' },
    ];

    it('should find active segment for given time', () => {
      expect(findActiveSegment(segments, 2.5)?.text).toBe('A');
      expect(findActiveSegment(segments, 7)?.text).toBe('B');
      expect(findActiveSegment(segments, 12)?.text).toBe('C');
    });

    it('should return segment at exact start time', () => {
      expect(findActiveSegment(segments, 0)?.text).toBe('A');
      expect(findActiveSegment(segments, 5)?.text).toBe('B');
    });

    it('should return undefined for time outside all segments', () => {
      expect(findActiveSegment(segments, -1)).toBeUndefined();
      expect(findActiveSegment(segments, 20)).toBeUndefined();
    });

    it('should not include end time (exclusive)', () => {
      // At exactly end time, should not be active
      expect(findActiveSegment(segments, 15)).toBeUndefined();
    });
  });

  describe('validateSegments', () => {
    it('should validate correct segments', () => {
      const segments: CaptionSegment[] = [
        { sequenceNumber: 1, startTime: 0, endTime: 5, text: 'A' },
        { sequenceNumber: 2, startTime: 5, endTime: 10, text: 'B' },
      ];

      const result = validateSegments(segments);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should detect invalid timing (end before start)', () => {
      const segments: CaptionSegment[] = [
        { sequenceNumber: 1, startTime: 5, endTime: 2, text: 'Invalid' },
      ];

      const result = validateSegments(segments);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Segment 1: End time must be after start time',
      );
    });

    it('should detect negative start time', () => {
      const segments: CaptionSegment[] = [
        { sequenceNumber: 1, startTime: -1, endTime: 2, text: 'Invalid' },
      ];

      const result = validateSegments(segments);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Segment 1: Start time cannot be negative',
      );
    });

    it('should detect empty text', () => {
      const segments: CaptionSegment[] = [
        { sequenceNumber: 1, startTime: 0, endTime: 2, text: '   ' },
      ];

      const result = validateSegments(segments);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Segment 1: Text cannot be empty');
    });

    it('should warn about overlapping segments', () => {
      const segments: CaptionSegment[] = [
        { sequenceNumber: 1, startTime: 0, endTime: 5, text: 'A' },
        { sequenceNumber: 2, startTime: 4, endTime: 8, text: 'B' },
      ];

      const result = validateSegments(segments);

      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('Segments 1 and 2 overlap');
    });
  });

  describe('LANGUAGE_NAMES', () => {
    it('should contain common languages', () => {
      expect(LANGUAGE_NAMES['en']).toBe('English');
      expect(LANGUAGE_NAMES['es']).toBe('Spanish');
      expect(LANGUAGE_NAMES['fr']).toBe('French');
      expect(LANGUAGE_NAMES['de']).toBe('German');
      expect(LANGUAGE_NAMES['ja']).toBe('Japanese');
      expect(LANGUAGE_NAMES['zh']).toBe('Chinese');
    });

    it('should have 12 supported languages', () => {
      expect(Object.keys(LANGUAGE_NAMES)).toHaveLength(12);
    });
  });

  describe('getLanguageName', () => {
    it('should return language name for known codes', () => {
      expect(getLanguageName('en')).toBe('English');
      expect(getLanguageName('es')).toBe('Spanish');
    });

    it('should return uppercase code for unknown languages', () => {
      expect(getLanguageName('xx')).toBe('XX');
      expect(getLanguageName('unknown')).toBe('UNKNOWN');
    });
  });
});
