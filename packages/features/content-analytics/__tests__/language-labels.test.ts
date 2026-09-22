import { describe, expect, it } from 'vitest';

import { summariseLanguagePairs } from '../src/lib/language-divergence';
import {
  LANGUAGE_NOT_SET_KEY,
  languageColor,
  languageFlag,
  languageFromKey,
  languageKey,
  languageName,
  resolveLanguageDimension,
} from '../src/lib/language-labels';

describe('naming a language, or the absence of one (FILM-1702)', () => {
  it('never names a language nobody set as English', () => {
    // The old tables did `NAMES[code] || code.toUpperCase()`, and the value
    // reaching them was a defaulted 'en'.
    expect(languageName(null)).toBe('Language not set');
    expect(languageName(null)).not.toMatch(/english/i);
  });

  it('words the absence by dimension, because the absence differs', () => {
    expect(languageName(null, 'content')).toBe('Language not set');
    expect(languageName(null, 'channel')).toBe('No channel target');
  });

  it('names known codes, and upper-cases one it has no name for', () => {
    expect(languageName('en')).toBe('English');
    expect(languageName('es', 'channel')).toBe('Spanish');
    expect(languageName('sw')).toBe('SW');
  });

  it('gives the unlabelled bucket no flag, and no language colour', () => {
    expect(languageFlag(null)).toBeNull();
    expect(languageFlag('en')).toBe('🇺🇸');
    expect(languageColor(null)).not.toBe(languageColor('en'));
  });

  it('round-trips a language through a string key without inventing one', () => {
    expect(languageFromKey(languageKey(null))).toBeNull();
    expect(languageFromKey(languageKey('hi'))).toBe('hi');
    // Longer than varchar(5), so no real code can collide with it.
    expect(LANGUAGE_NOT_SET_KEY.length).toBeGreaterThan(5);
  });

  it('resolves an unvalidated dimension to a known one', () => {
    expect(resolveLanguageDimension('channel')).toBe('channel');
    expect(resolveLanguageDimension('content')).toBe('content');
    expect(resolveLanguageDimension(undefined)).toBe('content');
    expect(resolveLanguageDimension('__proto__')).toBe('content');
    expect(resolveLanguageDimension({ toString: () => 'channel' })).toBe(
      'content',
    );
  });
});

describe('summariseLanguagePairs', () => {
  const PAIRS = [
    { language: 'en', channelLanguage: 'en', videoCount: 10 },
    { language: 'es', channelLanguage: 'en', videoCount: 3 },
    { language: 'hi', channelLanguage: 'es', videoCount: 1 },
    { language: null, channelLanguage: 'en', videoCount: 40 },
    { language: 'en', channelLanguage: null, videoCount: 2 },
    { language: null, channelLanguage: null, videoCount: 5 },
  ];

  it('counts a video as divergent only when both languages are known', () => {
    const summary = summariseLanguagePairs(PAIRS);

    // `null !== 'en'` is true, so a string comparison would have called all
    // 40 unlabelled videos misrouted and buried the 4 that are.
    expect(summary.divergentVideos).toBe(4);
    expect(summary.comparableVideos).toBe(14);
    expect(summary.totalVideos).toBe(61);
  });

  it('reports what it could not compare, instead of dropping it', () => {
    const summary = summariseLanguagePairs(PAIRS);

    expect(summary.contentNotSetVideos).toBe(45);
    expect(summary.channelNotSetVideos).toBe(7);
  });

  it('lists the disagreeing pairs, most videos first', () => {
    expect(summariseLanguagePairs(PAIRS).divergentPairs).toEqual([
      { language: 'es', channelLanguage: 'en', videoCount: 3 },
      { language: 'hi', channelLanguage: 'es', videoCount: 1 },
    ]);
  });

  it('is all zeros for no videos', () => {
    expect(summariseLanguagePairs([])).toEqual({
      totalVideos: 0,
      comparableVideos: 0,
      divergentVideos: 0,
      contentNotSetVideos: 0,
      channelNotSetVideos: 0,
      divergentPairs: [],
    });
  });
});
