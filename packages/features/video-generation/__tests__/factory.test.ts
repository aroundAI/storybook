import { afterEach, describe, expect, it } from 'vitest';

import {
  clearProviderCache,
  createVideoProvider,
  getVideoProvider,
} from '../src/providers/factory';

describe('Video Provider Factory', () => {
  afterEach(() => {
    clearProviderCache();
  });

  describe('createVideoProvider', () => {
    it('should create Kling provider', () => {
      const provider = createVideoProvider('kling', { apiKey: 'test-key' });

      expect(provider).toBeDefined();
      expect(provider.name).toBe('kling');
    });

    it('should create Runway provider', () => {
      const provider = createVideoProvider('runway', { apiKey: 'test-key' });

      expect(provider).toBeDefined();
      expect(provider.name).toBe('runway');
    });

    it('should create Luma provider', () => {
      const provider = createVideoProvider('luma', { apiKey: 'test-key' });

      expect(provider).toBeDefined();
      expect(provider.name).toBe('luma');
    });

    it('should throw for unknown provider', () => {
      expect(() =>
        createVideoProvider('unknown' as never, { apiKey: 'test-key' }),
      ).toThrow('Unknown video provider: unknown');
    });

    it('should return cached instance for same config', () => {
      const config = { apiKey: 'test-key' };
      const provider1 = createVideoProvider('kling', config);
      const provider2 = createVideoProvider('kling', config);

      expect(provider1).toBe(provider2);
    });

    it('should return new instance for different apiKey', () => {
      const provider1 = createVideoProvider('kling', { apiKey: 'key-1' });
      const provider2 = createVideoProvider('kling', { apiKey: 'key-2' });

      expect(provider1).not.toBe(provider2);
    });

    it('should return new instance for different baseUrl', () => {
      const provider1 = createVideoProvider('kling', {
        apiKey: 'test-key',
        baseUrl: 'https://api1.example.com',
      });
      const provider2 = createVideoProvider('kling', {
        apiKey: 'test-key',
        baseUrl: 'https://api2.example.com',
      });

      expect(provider1).not.toBe(provider2);
    });

    it('should cache different providers separately', () => {
      const klingProvider = createVideoProvider('kling', { apiKey: 'key' });
      const runwayProvider = createVideoProvider('runway', { apiKey: 'key' });

      expect(klingProvider.name).toBe('kling');
      expect(runwayProvider.name).toBe('runway');
      expect(klingProvider).not.toBe(runwayProvider);
    });
  });

  describe('getVideoProvider', () => {
    it('should return undefined for non-cached provider', () => {
      const provider = getVideoProvider('kling');
      expect(provider).toBeUndefined();
    });

    it('should return cached provider', () => {
      const created = createVideoProvider('kling', { apiKey: 'test-key' });
      const retrieved = getVideoProvider('kling');

      expect(retrieved).toBe(created);
    });

    it('should return undefined after cache clear', () => {
      createVideoProvider('kling', { apiKey: 'test-key' });
      clearProviderCache();

      const provider = getVideoProvider('kling');
      expect(provider).toBeUndefined();
    });
  });

  describe('clearProviderCache', () => {
    it('should clear all cached providers', () => {
      createVideoProvider('kling', { apiKey: 'key1' });
      createVideoProvider('runway', { apiKey: 'key2' });
      createVideoProvider('luma', { apiKey: 'key3' });

      clearProviderCache();

      expect(getVideoProvider('kling')).toBeUndefined();
      expect(getVideoProvider('runway')).toBeUndefined();
      expect(getVideoProvider('luma')).toBeUndefined();
    });
  });

  describe('Provider Capabilities', () => {
    it('should expose Kling capabilities', () => {
      const provider = createVideoProvider('kling', { apiKey: 'test' });

      expect(provider.capabilities.maxDuration).toBe(10);
      expect(provider.capabilities.supportedAspectRatios).toContain('16:9');
      expect(provider.capabilities.supportsNegativePrompt).toBe(true);
      expect(provider.capabilities.supportsImageToVideo).toBe(true);
    });

    it('should expose Runway capabilities', () => {
      const provider = createVideoProvider('runway', { apiKey: 'test' });

      expect(provider.capabilities.maxDuration).toBe(18);
      expect(provider.capabilities.supportedAspectRatios).toContain('16:9');
      expect(provider.capabilities.supportsNegativePrompt).toBe(false);
      expect(provider.capabilities.supportsImageToVideo).toBe(true);
    });

    it('should expose Luma capabilities', () => {
      const provider = createVideoProvider('luma', { apiKey: 'test' });

      expect(provider.capabilities.maxDuration).toBe(5);
      expect(provider.capabilities.supportedAspectRatios).toContain('16:9');
      expect(provider.capabilities.supportsNegativePrompt).toBe(false);
      expect(provider.capabilities.supportsImageToVideo).toBe(true);
    });
  });
});
