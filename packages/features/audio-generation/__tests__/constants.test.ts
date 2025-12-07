import { describe, expect, it } from 'vitest';

import {
  AUDIO_FORMATS,
  AUDIO_TYPES,
  DEFAULT_MUSIC_DURATION,
  DEFAULT_TIMEOUT,
  DEFAULT_VOICE_SETTINGS,
  ELEVENLABS,
  MAX_MUSIC_DURATION,
  MAX_RETRIES,
  MAX_TEXT_LENGTH,
  MUSIC_GENRES,
  MUSIC_MOODS,
  MUSIC_PROVIDERS,
  PLAYHT,
  PROVIDER_DISPLAY_NAMES,
  SUNO,
  UDIO,
  VOICE_PROVIDERS,
} from '../src/lib/constants';

describe('Audio Generation Constants', () => {
  describe('Provider Constants', () => {
    it('should define all voice providers', () => {
      expect(VOICE_PROVIDERS).toEqual({
        ELEVENLABS: 'elevenlabs',
        PLAYHT: 'playht',
        DEEPGRAM: 'deepgram',
        AZURE: 'azure',
        GOOGLE: 'google',
      });
    });

    it('should define all music providers', () => {
      expect(MUSIC_PROVIDERS).toEqual({
        SUNO: 'suno',
        UDIO: 'udio',
        MUBERT: 'mubert',
        BEATOVEN: 'beatoven',
      });
    });
  });

  describe('Audio Types and Formats', () => {
    it('should define all audio types', () => {
      expect(AUDIO_TYPES).toEqual({
        VOICE: 'voice',
        MUSIC: 'music',
        SFX: 'sfx',
      });
    });

    it('should define all audio formats', () => {
      expect(AUDIO_FORMATS).toEqual({
        MP3: 'mp3',
        WAV: 'wav',
        PCM: 'pcm',
        OGG: 'ogg',
      });
    });
  });

  describe('Default Settings', () => {
    it('should have valid default voice settings', () => {
      expect(DEFAULT_VOICE_SETTINGS.stability).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_VOICE_SETTINGS.stability).toBeLessThanOrEqual(1);
      expect(DEFAULT_VOICE_SETTINGS.similarityBoost).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_VOICE_SETTINGS.similarityBoost).toBeLessThanOrEqual(1);
      expect(DEFAULT_VOICE_SETTINGS.style).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_VOICE_SETTINGS.style).toBeLessThanOrEqual(1);
      expect(DEFAULT_VOICE_SETTINGS.speed).toBeGreaterThan(0);
      expect(typeof DEFAULT_VOICE_SETTINGS.useSpeakerBoost).toBe('boolean');
    });
  });

  describe('Limits', () => {
    it('should have reasonable text length limit', () => {
      expect(MAX_TEXT_LENGTH).toBe(5000);
    });

    it('should have reasonable music duration limits', () => {
      expect(MAX_MUSIC_DURATION).toBe(240); // 4 minutes
      expect(DEFAULT_MUSIC_DURATION).toBe(60); // 1 minute
      expect(DEFAULT_MUSIC_DURATION).toBeLessThan(MAX_MUSIC_DURATION);
    });

    it('should have reasonable retry and timeout values', () => {
      expect(MAX_RETRIES).toBe(5);
      expect(DEFAULT_TIMEOUT).toBe(30000); // 30 seconds
    });
  });

  describe('ElevenLabs Constants', () => {
    it('should have valid base URL', () => {
      expect(ELEVENLABS.BASE_URL).toBe('https://api.elevenlabs.io/v1');
    });

    it('should have supported languages', () => {
      expect(ELEVENLABS.SUPPORTED_LANGUAGES).toContain('en');
      expect(ELEVENLABS.SUPPORTED_LANGUAGES).toContain('es');
      expect(ELEVENLABS.SUPPORTED_LANGUAGES).toContain('fr');
      expect(ELEVENLABS.SUPPORTED_LANGUAGES.length).toBeGreaterThan(10);
    });

    it('should have valid output formats', () => {
      expect(ELEVENLABS.OUTPUT_FORMATS).toContain('mp3_44100_128');
      expect(ELEVENLABS.OUTPUT_FORMATS).toContain('pcm_44100');
    });

    it('should have cost per 1000 chars', () => {
      expect(ELEVENLABS.COST_PER_1000_CHARS).toBe(30); // $0.30
    });
  });

  describe('PlayHT Constants', () => {
    it('should have valid base URL', () => {
      expect(PLAYHT.BASE_URL).toBe('https://api.play.ht/api/v2');
    });

    it('should have locale-specific language codes', () => {
      expect(PLAYHT.SUPPORTED_LANGUAGES).toContain('en-US');
      expect(PLAYHT.SUPPORTED_LANGUAGES).toContain('en-GB');
      expect(PLAYHT.SUPPORTED_LANGUAGES).toContain('es-ES');
    });

    it('should have sample rates', () => {
      expect(PLAYHT.SAMPLE_RATES).toContain(44100);
      expect(PLAYHT.SAMPLE_RATES).toContain(48000);
    });
  });

  describe('Suno Constants', () => {
    it('should have max duration', () => {
      expect(SUNO.MAX_DURATION).toBe(240); // 4 minutes
    });

    it('should have supported genres', () => {
      expect(SUNO.SUPPORTED_GENRES).toContain('cinematic');
      expect(SUNO.SUPPORTED_GENRES).toContain('orchestral');
      expect(SUNO.SUPPORTED_GENRES).toContain('electronic');
    });
  });

  describe('Udio Constants', () => {
    it('should have max duration', () => {
      expect(UDIO.MAX_DURATION).toBe(240); // 4 minutes
    });

    it('should have supported genres', () => {
      expect(UDIO.SUPPORTED_GENRES).toContain('metal');
      expect(UDIO.SUPPORTED_GENRES).toContain('country');
    });
  });

  describe('Music Genres and Moods', () => {
    it('should have common music genres', () => {
      expect(MUSIC_GENRES).toContain('cinematic');
      expect(MUSIC_GENRES).toContain('orchestral');
      expect(MUSIC_GENRES).toContain('electronic');
      expect(MUSIC_GENRES).toContain('ambient');
      expect(MUSIC_GENRES).toContain('lofi');
    });

    it('should have common music moods', () => {
      expect(MUSIC_MOODS).toContain('epic');
      expect(MUSIC_MOODS).toContain('dramatic');
      expect(MUSIC_MOODS).toContain('suspenseful');
      expect(MUSIC_MOODS).toContain('calm');
    });
  });

  describe('Provider Display Names', () => {
    it('should have display names for all providers', () => {
      expect(PROVIDER_DISPLAY_NAMES.elevenlabs).toBe('ElevenLabs');
      expect(PROVIDER_DISPLAY_NAMES.playht).toBe('PlayHT');
      expect(PROVIDER_DISPLAY_NAMES.suno).toBe('Suno');
      expect(PROVIDER_DISPLAY_NAMES.udio).toBe('Udio');
    });
  });
});
