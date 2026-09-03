import { describe, expect, it } from 'vitest';

import {
  CreateProjectSchema,
  ProjectTypeSchema,
  StudioProjectSettingsSchema,
  TargetPlatformSchema,
  UpdateProjectSchema,
  VideoStyleSchema,
} from '../src/project';

describe('Project Schemas', () => {
  describe('ProjectTypeSchema', () => {
    it('should accept valid project types', () => {
      // The full enum, so adding a type without updating this test shows up
      // here rather than only in the reject case.
      const validTypes = [
        'short-film',
        'series',
        'movie',
        'documentary',
        'ad',
        'educational',
        'news',
      ];
      validTypes.forEach((type) => {
        expect(ProjectTypeSchema.safeParse(type).success).toBe(true);
      });
    });

    it('should reject invalid project types', () => {
      // 'movie' used to be the example here; it became a real project type
      // in #220, so it is asserted as valid above instead. Kept a value
      // that is genuinely outside the enum so the test still tests
      // something.
      expect(ProjectTypeSchema.safeParse('podcast').success).toBe(false);
      expect(ProjectTypeSchema.safeParse('').success).toBe(false);
    });
  });

  describe('TargetPlatformSchema', () => {
    it('should accept valid platforms', () => {
      const validPlatforms = [
        'youtube',
        'tiktok',
        'instagram',
        'facebook',
        'twitter',
        'linkedin',
        'custom',
      ];
      validPlatforms.forEach((platform) => {
        expect(TargetPlatformSchema.safeParse(platform).success).toBe(true);
      });
    });

    it('should reject invalid platforms', () => {
      expect(TargetPlatformSchema.safeParse('snapchat').success).toBe(false);
    });
  });

  describe('VideoStyleSchema', () => {
    it('should accept valid video styles', () => {
      const validStyles = [
        'realistic',
        'animated',
        'cartoon',
        'anime',
        'cinematic',
        'documentary',
        'vlog',
        'commercial',
      ];
      validStyles.forEach((style) => {
        expect(VideoStyleSchema.safeParse(style).success).toBe(true);
      });
    });

    it('should reject invalid video styles', () => {
      expect(VideoStyleSchema.safeParse('3d').success).toBe(false);
    });
  });

  describe('StudioProjectSettingsSchema', () => {
    it('should accept valid settings', () => {
      const validSettings = {
        projectType: 'short-film',
        targetPlatforms: ['youtube', 'tiktok'],
        videoStyle: 'cinematic',
      };
      expect(StudioProjectSettingsSchema.safeParse(validSettings).success).toBe(
        true,
      );
    });

    it('should apply defaults', () => {
      const result = StudioProjectSettingsSchema.parse({
        projectType: 'series',
        targetPlatforms: ['youtube'],
        videoStyle: 'animated',
      });
      expect(result.defaultAspectRatio).toBe('16:9');
      expect(result.defaultDuration).toBe(5);
      expect(result.defaultProvider).toBe('kling');
      expect(result.language).toBe('en');
      expect(result.subtitlesEnabled).toBe(false);
    });

    it('should require at least one target platform', () => {
      const invalidSettings = {
        projectType: 'short-film',
        targetPlatforms: [],
        videoStyle: 'cinematic',
      };
      expect(
        StudioProjectSettingsSchema.safeParse(invalidSettings).success,
      ).toBe(false);
    });

    it('should validate aspect ratio format', () => {
      const validSettings = {
        projectType: 'short-film',
        targetPlatforms: ['youtube'],
        videoStyle: 'cinematic',
        defaultAspectRatio: '9:16',
      };
      expect(StudioProjectSettingsSchema.safeParse(validSettings).success).toBe(
        true,
      );

      const invalidSettings = {
        ...validSettings,
        defaultAspectRatio: 'wide',
      };
      expect(
        StudioProjectSettingsSchema.safeParse(invalidSettings).success,
      ).toBe(false);
    });

    it('should accept optional fields', () => {
      const settings = {
        projectType: 'documentary',
        targetPlatforms: ['youtube'],
        videoStyle: 'documentary',
        audioProvider: 'elevenlabs',
        targetAudience: 'general',
        contentRating: 'PG',
      };
      expect(StudioProjectSettingsSchema.safeParse(settings).success).toBe(
        true,
      );
    });
  });

  describe('CreateProjectSchema', () => {
    it('should accept valid project data', () => {
      const validProject = {
        name: 'My Project',
        description: 'A test project',
      };
      expect(CreateProjectSchema.safeParse(validProject).success).toBe(true);
    });

    it('should require name', () => {
      expect(CreateProjectSchema.safeParse({}).success).toBe(false);
      expect(CreateProjectSchema.safeParse({ name: '' }).success).toBe(false);
    });

    it('should enforce max name length', () => {
      expect(
        CreateProjectSchema.safeParse({ name: 'a'.repeat(256) }).success,
      ).toBe(false);
      expect(
        CreateProjectSchema.safeParse({ name: 'a'.repeat(255) }).success,
      ).toBe(true);
    });

    it('should accept optional settings', () => {
      const projectWithSettings = {
        name: 'My Project',
        settings: {
          projectType: 'short-film',
          targetPlatforms: ['youtube'],
          videoStyle: 'cinematic',
        },
      };
      expect(CreateProjectSchema.safeParse(projectWithSettings).success).toBe(
        true,
      );
    });
  });

  describe('UpdateProjectSchema', () => {
    it('should require id', () => {
      expect(UpdateProjectSchema.safeParse({ name: 'New Name' }).success).toBe(
        false,
      );
    });

    it('should accept partial updates', () => {
      const validUpdate = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Updated Name',
      };
      expect(UpdateProjectSchema.safeParse(validUpdate).success).toBe(true);
    });

    it('should allow updating only id (no changes)', () => {
      const idOnly = {
        id: '123e4567-e89b-12d3-a456-426614174000',
      };
      expect(UpdateProjectSchema.safeParse(idOnly).success).toBe(true);
    });
  });
});
