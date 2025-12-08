import { describe, expect, it } from 'vitest';

import {
  CreateEpisodeSchema,
  EpisodeMetadataSchema,
  EpisodeStatusSchema,
  GenerateEpisodeFromPromptSchema,
  SceneSchema,
  UpdateEpisodeSchema,
} from '../src/episode';

describe('Episode Schemas', () => {
  const validUUID = '123e4567-e89b-12d3-a456-426614174000';

  describe('EpisodeStatusSchema', () => {
    it('should accept valid statuses', () => {
      const validStatuses = [
        'draft',
        'planning',
        'scripting',
        'in_progress',
        'reviewing',
        'completed',
        'published',
        'archived',
      ];
      validStatuses.forEach((status) => {
        expect(EpisodeStatusSchema.safeParse(status).success).toBe(true);
      });
    });

    it('should reject invalid statuses', () => {
      expect(EpisodeStatusSchema.safeParse('pending').success).toBe(false);
      expect(EpisodeStatusSchema.safeParse('').success).toBe(false);
    });
  });

  describe('EpisodeMetadataSchema', () => {
    it('should accept valid metadata', () => {
      const validMetadata = {
        sceneCount: 5,
        shotCount: 25,
        totalDuration: 300,
        themes: ['adventure', 'mystery'],
        tags: ['action', 'drama'],
        characters: [validUUID],
        locations: [validUUID],
        estimatedCost: 150.5,
        targetAudience: 'young adults',
      };
      expect(EpisodeMetadataSchema.safeParse(validMetadata).success).toBe(true);
    });

    it('should accept empty object', () => {
      expect(EpisodeMetadataSchema.safeParse({}).success).toBe(true);
    });

    it('should reject negative counts', () => {
      expect(EpisodeMetadataSchema.safeParse({ sceneCount: -1 }).success).toBe(
        false,
      );
      expect(EpisodeMetadataSchema.safeParse({ shotCount: -5 }).success).toBe(
        false,
      );
    });

    it('should reject non-integer counts', () => {
      expect(EpisodeMetadataSchema.safeParse({ sceneCount: 5.5 }).success).toBe(
        false,
      );
    });
  });

  describe('CreateEpisodeSchema', () => {
    it('should accept valid episode data', () => {
      const validEpisode = {
        projectId: validUUID,
        title: 'Episode 1: The Beginning',
        description: 'First episode',
        episodeNumber: 1,
      };
      expect(CreateEpisodeSchema.safeParse(validEpisode).success).toBe(true);
    });

    it('should require projectId, title, and episodeNumber', () => {
      expect(CreateEpisodeSchema.safeParse({}).success).toBe(false);
      expect(
        CreateEpisodeSchema.safeParse({
          projectId: validUUID,
          title: 'Test',
        }).success,
      ).toBe(false);
    });

    it('should enforce positive episode number', () => {
      expect(
        CreateEpisodeSchema.safeParse({
          projectId: validUUID,
          title: 'Test',
          episodeNumber: 0,
        }).success,
      ).toBe(false);
      expect(
        CreateEpisodeSchema.safeParse({
          projectId: validUUID,
          title: 'Test',
          episodeNumber: -1,
        }).success,
      ).toBe(false);
    });

    it('should enforce title length', () => {
      expect(
        CreateEpisodeSchema.safeParse({
          projectId: validUUID,
          title: '',
          episodeNumber: 1,
        }).success,
      ).toBe(false);
      expect(
        CreateEpisodeSchema.safeParse({
          projectId: validUUID,
          title: 'a'.repeat(256),
          episodeNumber: 1,
        }).success,
      ).toBe(false);
    });

    it('should accept optional season number', () => {
      const withSeason = {
        projectId: validUUID,
        title: 'Episode 1',
        episodeNumber: 1,
        seasonNumber: 2,
      };
      expect(CreateEpisodeSchema.safeParse(withSeason).success).toBe(true);
    });

    it('should accept optional script and duration', () => {
      const withOptionals = {
        projectId: validUUID,
        title: 'Episode 1',
        episodeNumber: 1,
        script: 'FADE IN: A dark room...',
        duration: 1800,
      };
      expect(CreateEpisodeSchema.safeParse(withOptionals).success).toBe(true);
    });
  });

  describe('UpdateEpisodeSchema', () => {
    it('should require id', () => {
      expect(
        UpdateEpisodeSchema.safeParse({ title: 'New Title' }).success,
      ).toBe(false);
    });

    it('should accept partial updates', () => {
      const validUpdate = {
        id: validUUID,
        title: 'Updated Title',
      };
      expect(UpdateEpisodeSchema.safeParse(validUpdate).success).toBe(true);
    });

    it('should accept status update', () => {
      const statusUpdate = {
        id: validUUID,
        status: 'completed',
      };
      expect(UpdateEpisodeSchema.safeParse(statusUpdate).success).toBe(true);
    });

    it('should reject invalid status', () => {
      const invalidStatus = {
        id: validUUID,
        status: 'invalid_status',
      };
      expect(UpdateEpisodeSchema.safeParse(invalidStatus).success).toBe(false);
    });
  });

  describe('GenerateEpisodeFromPromptSchema', () => {
    it('should accept valid generation request', () => {
      const validRequest = {
        projectId: validUUID,
        prompt: 'Create an episode about a detective solving a mystery',
        episodeNumber: 1,
      };
      expect(
        GenerateEpisodeFromPromptSchema.safeParse(validRequest).success,
      ).toBe(true);
    });

    it('should enforce minimum prompt length', () => {
      expect(
        GenerateEpisodeFromPromptSchema.safeParse({
          projectId: validUUID,
          prompt: 'short',
          episodeNumber: 1,
        }).success,
      ).toBe(false);
    });

    it('should enforce maximum prompt length', () => {
      expect(
        GenerateEpisodeFromPromptSchema.safeParse({
          projectId: validUUID,
          prompt: 'a'.repeat(5001),
          episodeNumber: 1,
        }).success,
      ).toBe(false);
    });

    it('should apply default for includeDialogue', () => {
      const result = GenerateEpisodeFromPromptSchema.parse({
        projectId: validUUID,
        prompt: 'Create an episode about adventure',
        episodeNumber: 1,
      });
      expect(result.includeDialogue).toBe(true);
    });

    it('should accept optional style and tone', () => {
      const withOptions = {
        projectId: validUUID,
        prompt: 'Create an episode about adventure',
        episodeNumber: 1,
        style: 'noir',
        tone: 'dark',
        targetDuration: 600,
      };
      expect(
        GenerateEpisodeFromPromptSchema.safeParse(withOptions).success,
      ).toBe(true);
    });
  });

  describe('SceneSchema', () => {
    it('should accept valid scene data', () => {
      const validScene = {
        sceneNumber: 1,
        title: 'Opening Scene',
        description: 'The hero wakes up in a strange place',
        location: 'Abandoned warehouse',
        timeOfDay: 'night',
        characters: ['Hero', 'Villain'],
        duration: 120,
      };
      expect(SceneSchema.safeParse(validScene).success).toBe(true);
    });

    it('should require sceneNumber and description', () => {
      expect(SceneSchema.safeParse({}).success).toBe(false);
      expect(SceneSchema.safeParse({ sceneNumber: 1 }).success).toBe(false);
    });

    it('should enforce positive scene number', () => {
      expect(
        SceneSchema.safeParse({
          sceneNumber: 0,
          description: 'Test',
        }).success,
      ).toBe(false);
    });

    it('should accept shots array', () => {
      const withShots = {
        sceneNumber: 1,
        description: 'Test scene',
        shots: [{ id: 1 }, { id: 2 }],
      };
      expect(SceneSchema.safeParse(withShots).success).toBe(true);
    });
  });
});
