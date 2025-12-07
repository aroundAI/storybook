import { describe, expect, it } from 'vitest';

import {
  assetTypeTokens,
  episodeStatusTokens,
  getAllAssetTypes,
  getAllEpisodeStatuses,
  getAllProviders,
  getAllStatuses,
  getAllTrackTypes,
  getAssetTypeBadge,
  getAudioProviders,
  getEpisodeStatus,
  getNextEpisodeStatus,
  getPlatformProviders,
  getProviderInfo,
  getProvidersByCategory,
  getStatusClasses,
  getStatusToken,
  getTrackClasses,
  getVideoProviders,
  isActiveStatus,
  isTerminalStatus,
  providerTokens,
  statusTokens,
  timelineTrackTokens,
} from '../src/lib/design-tokens';

describe('Design Tokens', () => {
  describe('statusTokens', () => {
    it('should have all required status types', () => {
      const expectedStatuses = [
        'pending',
        'queued',
        'generating',
        'completed',
        'failed',
        'approved',
      ];

      expectedStatuses.forEach((status) => {
        expect(statusTokens).toHaveProperty(status);
      });
    });

    it('should have required properties for each status', () => {
      Object.values(statusTokens).forEach((token) => {
        expect(token).toHaveProperty('bg');
        expect(token).toHaveProperty('text');
        expect(token).toHaveProperty('border');
        expect(token).toHaveProperty('ring');
        expect(token).toHaveProperty('icon');
        expect(token).toHaveProperty('label');
      });
    });

    it('should have dark mode variants for background classes', () => {
      Object.values(statusTokens).forEach((token) => {
        expect(token.bg).toMatch(/dark:/);
      });
    });

    it('should have ring classes for focus states with dark mode variants', () => {
      Object.values(statusTokens).forEach((token) => {
        expect(token.ring).toMatch(/^ring-/);
        expect(token.ring).toMatch(/dark:ring-/);
      });
    });
  });

  describe('assetTypeTokens', () => {
    it('should have all required asset types', () => {
      const expectedTypes = [
        'character',
        'location',
        'prop',
        'voice',
        'music',
        'sfx',
      ];

      expectedTypes.forEach((type) => {
        expect(assetTypeTokens).toHaveProperty(type);
      });
    });

    it('should have required properties for each asset type', () => {
      Object.values(assetTypeTokens).forEach((token) => {
        expect(token).toHaveProperty('bg');
        expect(token).toHaveProperty('bgLight');
        expect(token).toHaveProperty('text');
        expect(token).toHaveProperty('icon');
        expect(token).toHaveProperty('label');
      });
    });
  });

  describe('timelineTrackTokens', () => {
    it('should have all required track types', () => {
      const expectedTracks = ['video', 'dialogue', 'music', 'sfx', 'ambient'];

      expectedTracks.forEach((track) => {
        expect(timelineTrackTokens).toHaveProperty(track);
      });
    });

    it('should have required properties for each track', () => {
      Object.values(timelineTrackTokens).forEach((token) => {
        expect(token).toHaveProperty('bg');
        expect(token).toHaveProperty('bgHover');
        expect(token).toHaveProperty('border');
        expect(token).toHaveProperty('text');
        expect(token).toHaveProperty('label');
      });
    });
  });

  describe('episodeStatusTokens', () => {
    it('should have all required episode statuses', () => {
      const expectedStatuses = [
        'draft',
        'story',
        'storyboard',
        'generating',
        'editing',
        'ready',
        'published',
      ];

      expectedStatuses.forEach((status) => {
        expect(episodeStatusTokens).toHaveProperty(status);
      });
    });

    it('should have required properties for each episode status', () => {
      Object.values(episodeStatusTokens).forEach((token) => {
        expect(token).toHaveProperty('label');
        expect(token).toHaveProperty('color');
        expect(token).toHaveProperty('step');
        expect(token).toHaveProperty('description');
      });
    });

    it('should have sequential step numbers', () => {
      const steps = Object.values(episodeStatusTokens).map((t) => t.step);
      const sorted = [...steps].sort((a, b) => a - b);

      expect(sorted).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });
  });

  describe('providerTokens', () => {
    it('should have all video providers', () => {
      const videoProviders = ['kling', 'runway', 'hailuo'];

      videoProviders.forEach((provider) => {
        expect(providerTokens).toHaveProperty(provider);
      });
    });

    it('should have all audio providers', () => {
      const audioProviders = ['elevenlabs', 'playht', 'suno', 'udio'];

      audioProviders.forEach((provider) => {
        expect(providerTokens).toHaveProperty(provider);
      });
    });

    it('should have all platform providers', () => {
      const platformProviders = ['youtube', 'tiktok', 'instagram', 'facebook'];

      platformProviders.forEach((provider) => {
        expect(providerTokens).toHaveProperty(provider);
      });
    });

    it('should have required properties for each provider', () => {
      Object.values(providerTokens).forEach((token) => {
        expect(token).toHaveProperty('name');
        expect(token).toHaveProperty('bg');
        expect(token).toHaveProperty('icon');
        expect(token).toHaveProperty('category');
      });
    });

    it('should have valid category for each provider', () => {
      const validCategories = ['video', 'audio', 'platform'];

      Object.values(providerTokens).forEach((token) => {
        expect(validCategories).toContain(token.category);
      });
    });

    it('should have correct category for video providers', () => {
      expect(providerTokens.kling.category).toBe('video');
      expect(providerTokens.runway.category).toBe('video');
      expect(providerTokens.hailuo.category).toBe('video');
    });

    it('should have correct category for audio providers', () => {
      expect(providerTokens.elevenlabs.category).toBe('audio');
      expect(providerTokens.playht.category).toBe('audio');
      expect(providerTokens.suno.category).toBe('audio');
      expect(providerTokens.udio.category).toBe('audio');
    });

    it('should have correct category for platform providers', () => {
      expect(providerTokens.youtube.category).toBe('platform');
      expect(providerTokens.tiktok.category).toBe('platform');
      expect(providerTokens.instagram.category).toBe('platform');
      expect(providerTokens.facebook.category).toBe('platform');
    });
  });
});

describe('Utility Functions', () => {
  describe('getStatusToken', () => {
    it('should return correct token for each status', () => {
      expect(getStatusToken('pending')).toBe(statusTokens.pending);
      expect(getStatusToken('completed')).toBe(statusTokens.completed);
      expect(getStatusToken('failed')).toBe(statusTokens.failed);
    });
  });

  describe('getStatusClasses', () => {
    it('should compose Tailwind classes correctly', () => {
      const classes = getStatusClasses('pending');

      expect(classes).toContain('bg-slate-100');
      expect(classes).toContain('text-slate-600');
      expect(classes).toContain('border-slate-200');
    });

    it('should include dark mode classes', () => {
      const classes = getStatusClasses('completed');

      expect(classes).toContain('dark:bg-green-900/30');
      expect(classes).toContain('dark:text-green-400');
    });
  });

  describe('getAssetTypeBadge', () => {
    it('should return badge info for character type', () => {
      const badge = getAssetTypeBadge('character');

      expect(badge.className).toContain('bg-pink-100');
      expect(badge.className).toContain('text-pink-700');
      expect(badge.icon).toBe('User');
      expect(badge.label).toBe('Character');
    });

    it('should return badge info for location type', () => {
      const badge = getAssetTypeBadge('location');

      expect(badge.icon).toBe('MapPin');
      expect(badge.label).toBe('Location');
    });
  });

  describe('getTrackClasses', () => {
    it('should compose track classes correctly', () => {
      const classes = getTrackClasses('video');

      expect(classes).toContain('bg-blue-600');
      expect(classes).toContain('text-white');
      expect(classes).toContain('border-blue-700');
    });
  });

  describe('getEpisodeStatus', () => {
    it('should return correct episode status info', () => {
      const status = getEpisodeStatus('draft');

      expect(status.label).toBe('Draft');
      expect(status.step).toBe(0);
      expect(status.color).toBe('slate');
    });
  });

  describe('getProviderInfo', () => {
    it('should return correct provider info', () => {
      const info = getProviderInfo('kling');

      expect(info.name).toBe('Kling');
      expect(info.bg).toBe('bg-indigo-600');
      expect(info.icon).toBe('Video');
    });
  });

  describe('isTerminalStatus', () => {
    it('should return true for terminal statuses', () => {
      expect(isTerminalStatus('completed')).toBe(true);
      expect(isTerminalStatus('failed')).toBe(true);
      expect(isTerminalStatus('approved')).toBe(true);
    });

    it('should return false for non-terminal statuses', () => {
      expect(isTerminalStatus('pending')).toBe(false);
      expect(isTerminalStatus('queued')).toBe(false);
      expect(isTerminalStatus('generating')).toBe(false);
    });
  });

  describe('isActiveStatus', () => {
    it('should return true for active statuses', () => {
      expect(isActiveStatus('queued')).toBe(true);
      expect(isActiveStatus('generating')).toBe(true);
    });

    it('should return false for inactive statuses', () => {
      expect(isActiveStatus('pending')).toBe(false);
      expect(isActiveStatus('completed')).toBe(false);
      expect(isActiveStatus('failed')).toBe(false);
    });
  });

  describe('getNextEpisodeStatus', () => {
    it('should return next status in workflow', () => {
      expect(getNextEpisodeStatus('draft')).toBe('story');
      expect(getNextEpisodeStatus('story')).toBe('storyboard');
      expect(getNextEpisodeStatus('storyboard')).toBe('generating');
      expect(getNextEpisodeStatus('generating')).toBe('editing');
      expect(getNextEpisodeStatus('editing')).toBe('ready');
      expect(getNextEpisodeStatus('ready')).toBe('published');
    });

    it('should return null for final status', () => {
      expect(getNextEpisodeStatus('published')).toBeNull();
    });
  });

  describe('getAllStatuses', () => {
    it('should return all status types', () => {
      const statuses = getAllStatuses();

      expect(statuses).toContain('pending');
      expect(statuses).toContain('queued');
      expect(statuses).toContain('generating');
      expect(statuses).toContain('completed');
      expect(statuses).toContain('failed');
      expect(statuses).toContain('approved');
      expect(statuses).toHaveLength(6);
    });
  });

  describe('getAllAssetTypes', () => {
    it('should return all asset types', () => {
      const types = getAllAssetTypes();

      expect(types).toContain('character');
      expect(types).toContain('location');
      expect(types).toContain('prop');
      expect(types).toContain('voice');
      expect(types).toContain('music');
      expect(types).toContain('sfx');
      expect(types).toHaveLength(6);
    });
  });

  describe('getAllTrackTypes', () => {
    it('should return all track types', () => {
      const types = getAllTrackTypes();

      expect(types).toContain('video');
      expect(types).toContain('dialogue');
      expect(types).toContain('music');
      expect(types).toContain('sfx');
      expect(types).toContain('ambient');
      expect(types).toHaveLength(5);
    });
  });

  describe('getAllEpisodeStatuses', () => {
    it('should return all episode statuses', () => {
      const statuses = getAllEpisodeStatuses();

      expect(statuses).toContain('draft');
      expect(statuses).toContain('story');
      expect(statuses).toContain('storyboard');
      expect(statuses).toContain('generating');
      expect(statuses).toContain('editing');
      expect(statuses).toContain('ready');
      expect(statuses).toContain('published');
      expect(statuses).toHaveLength(7);
    });
  });

  describe('getAllProviders', () => {
    it('should return all providers', () => {
      const providers = getAllProviders();

      expect(providers).toHaveLength(11);
    });
  });

  describe('getProvidersByCategory', () => {
    it('should return video providers when category is video', () => {
      const providers = getProvidersByCategory('video');

      expect(providers).toContain('kling');
      expect(providers).toContain('runway');
      expect(providers).toContain('hailuo');
      expect(providers).toHaveLength(3);
    });

    it('should return audio providers when category is audio', () => {
      const providers = getProvidersByCategory('audio');

      expect(providers).toContain('elevenlabs');
      expect(providers).toContain('playht');
      expect(providers).toContain('suno');
      expect(providers).toContain('udio');
      expect(providers).toHaveLength(4);
    });

    it('should return platform providers when category is platform', () => {
      const providers = getProvidersByCategory('platform');

      expect(providers).toContain('youtube');
      expect(providers).toContain('tiktok');
      expect(providers).toContain('instagram');
      expect(providers).toContain('facebook');
      expect(providers).toHaveLength(4);
    });
  });

  describe('getVideoProviders', () => {
    it('should return only video providers', () => {
      const providers = getVideoProviders();

      expect(providers).toContain('kling');
      expect(providers).toContain('runway');
      expect(providers).toContain('hailuo');
      expect(providers).toHaveLength(3);
    });
  });

  describe('getAudioProviders', () => {
    it('should return only audio providers', () => {
      const providers = getAudioProviders();

      expect(providers).toContain('elevenlabs');
      expect(providers).toContain('playht');
      expect(providers).toContain('suno');
      expect(providers).toContain('udio');
      expect(providers).toHaveLength(4);
    });
  });

  describe('getPlatformProviders', () => {
    it('should return only platform providers', () => {
      const providers = getPlatformProviders();

      expect(providers).toContain('youtube');
      expect(providers).toContain('tiktok');
      expect(providers).toContain('instagram');
      expect(providers).toContain('facebook');
      expect(providers).toHaveLength(4);
    });
  });
});

describe('Type Safety', () => {
  it('should enforce type constraints on status tokens', () => {
    const validStatus: keyof typeof statusTokens = 'pending';
    expect(statusTokens[validStatus]).toBeDefined();
  });

  it('should enforce type constraints on asset tokens', () => {
    const validType: keyof typeof assetTypeTokens = 'character';
    expect(assetTypeTokens[validType]).toBeDefined();
  });

  it('should enforce type constraints on track tokens', () => {
    const validTrack: keyof typeof timelineTrackTokens = 'video';
    expect(timelineTrackTokens[validTrack]).toBeDefined();
  });

  it('should enforce type constraints on episode tokens', () => {
    const validStatus: keyof typeof episodeStatusTokens = 'draft';
    expect(episodeStatusTokens[validStatus]).toBeDefined();
  });

  it('should enforce type constraints on provider tokens', () => {
    const validProvider: keyof typeof providerTokens = 'kling';
    expect(providerTokens[validProvider]).toBeDefined();
  });
});
