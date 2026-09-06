import { describe, expect, it } from 'vitest';

import type {
  ScreenplayData,
  ScreenplayScene,
  StoryData,
} from '../src/lib/types';
import {
  formatScreenplayForPrompt,
  formatStoryForPrompt,
} from '../src/lib/utils/format-for-prompt';

describe('Format For Prompt Utilities', () => {
  describe('formatScreenplayForPrompt', () => {
    it('should format a simple scene with location and description', () => {
      const screenplay: ScreenplayData = {
        scenes: [
          {
            number: 1,
            heading: 'INT./EXT. LIVING ROOM - DAY',
            location: 'Living Room',
            timeOfDay: 'day',
            estimatedDuration: 0,
            description: 'A cozy living room with sunlight streaming through.',
            dialogue: [],
          },
        ],
        metadata: {
          totalScenes: 1,
          estimatedDuration: 0,
          locations: ['Living Room'],
          characters: [],
        },
      };

      const result = formatScreenplayForPrompt(screenplay);

      expect(result).toContain('INT./EXT. LIVING ROOM - DAY');
      expect(result).toContain(
        'A cozy living room with sunlight streaming through.',
      );
    });

    it('should uppercase location and time of day', () => {
      const screenplay: ScreenplayData = {
        scenes: [
          {
            number: 1,
            heading: 'INT./EXT. KITCHEN - NIGHT',
            location: 'kitchen',
            timeOfDay: 'night',
            estimatedDuration: 0,
            description: 'Dark kitchen.',
            dialogue: [],
          },
        ],
        metadata: {
          totalScenes: 1,
          estimatedDuration: 0,
          locations: ['kitchen'],
          characters: [],
        },
      };

      const result = formatScreenplayForPrompt(screenplay);

      expect(result).toContain('INT./EXT. KITCHEN - NIGHT');
    });

    it('should default to DAY when timeOfDay is not provided', () => {
      const screenplay: ScreenplayData = {
        // `timeOfDay` is required by ScreenplayScene, and the formatter
        // still defends against its absence (`scene.timeOfDay?.… ?? 'DAY'`)
        // because screenplay_data is JSONB: rows stored before the field
        // existed do not have it. Testing that path needs a scene the type
        // forbids, which is the point of this case.
        scenes: [
          {
            number: 1,
            heading: 'INT./EXT. PARK - DAY',
            location: 'Park',
            description: 'A sunny park.',
            dialogue: [],
            estimatedDuration: 0,
          } as unknown as ScreenplayScene,
        ],
        metadata: {
          totalScenes: 1,
          estimatedDuration: 0,
          locations: ['Park'],
          characters: [],
        },
      };

      const result = formatScreenplayForPrompt(screenplay);

      expect(result).toContain('INT./EXT. PARK - DAY');
    });

    it('should format dialogue with character names uppercased', () => {
      const screenplay: ScreenplayData = {
        scenes: [
          {
            number: 1,
            heading: 'INT./EXT. OFFICE - DAY',
            location: 'Office',
            timeOfDay: 'day',
            estimatedDuration: 0,
            description: 'A modern office space.',
            dialogue: [
              {
                character: 'John',
                text: 'Hello, how are you?',
              },
            ],
          },
        ],
        metadata: {
          totalScenes: 1,
          estimatedDuration: 1,
          locations: ['Office'],
          characters: ['John'],
        },
      };

      const result = formatScreenplayForPrompt(screenplay);

      expect(result).toContain('JOHN');
      expect(result).toContain('Hello, how are you?');
    });

    it('should include parentheticals in dialogue', () => {
      const screenplay: ScreenplayData = {
        scenes: [
          {
            number: 1,
            heading: 'INT./EXT. CAFE - DAY',
            location: 'Cafe',
            timeOfDay: 'day',
            estimatedDuration: 0,
            description: 'A busy cafe.',
            dialogue: [
              {
                character: 'Maya',
                text: 'I need to tell you something.',
                parenthetical: 'nervously',
              },
            ],
          },
        ],
        metadata: {
          totalScenes: 1,
          estimatedDuration: 1,
          locations: ['Cafe'],
          characters: ['Maya'],
        },
      };

      const result = formatScreenplayForPrompt(screenplay);

      expect(result).toContain('MAYA');
      expect(result).toContain('(nervously)');
      expect(result).toContain('I need to tell you something.');
    });

    it('should format multiple dialogue lines in sequence', () => {
      const screenplay: ScreenplayData = {
        scenes: [
          {
            number: 1,
            heading: 'INT./EXT. RESTAURANT - NIGHT',
            location: 'Restaurant',
            timeOfDay: 'night',
            estimatedDuration: 0,
            description: 'An elegant restaurant.',
            dialogue: [
              { character: 'Alice', text: 'Good evening.' },
              { character: 'Bob', text: 'Nice to meet you.' },
              {
                character: 'Alice',
                text: 'Likewise.',
                parenthetical: 'smiling',
              },
            ],
          },
        ],
        metadata: {
          totalScenes: 1,
          estimatedDuration: 3,
          locations: ['Restaurant'],
          characters: ['Alice', 'Bob'],
        },
      };

      const result = formatScreenplayForPrompt(screenplay);

      expect(result).toContain('ALICE');
      expect(result).toContain('BOB');
      expect(result).toContain('Good evening.');
      expect(result).toContain('Nice to meet you.');
      expect(result).toContain('(smiling)');
      expect(result).toContain('Likewise.');
    });

    it('should format multiple scenes', () => {
      const screenplay: ScreenplayData = {
        scenes: [
          {
            number: 1,
            heading: 'INT./EXT. BEACH - DAWN',
            location: 'Beach',
            timeOfDay: 'dawn',
            estimatedDuration: 0,
            description: 'Sun rising over the ocean.',
            dialogue: [],
          },
          {
            number: 2,
            heading: 'INT./EXT. HOTEL ROOM - DAY',
            location: 'Hotel Room',
            timeOfDay: 'day',
            estimatedDuration: 0,
            description: 'A messy hotel room.',
            dialogue: [{ character: 'Guest', text: "Where's my phone?" }],
          },
        ],
        metadata: {
          totalScenes: 2,
          estimatedDuration: 1,
          locations: ['Beach', 'Hotel Room'],
          characters: ['Guest'],
        },
      };

      const result = formatScreenplayForPrompt(screenplay);

      expect(result).toContain('INT./EXT. BEACH - DAWN');
      expect(result).toContain('Sun rising over the ocean.');
      expect(result).toContain('INT./EXT. HOTEL ROOM - DAY');
      expect(result).toContain('A messy hotel room.');
      expect(result).toContain('GUEST');
      expect(result).toContain("Where's my phone?");
    });

    it('should handle empty scenes array', () => {
      const screenplay: ScreenplayData = {
        scenes: [],
        metadata: {
          totalScenes: 0,
          estimatedDuration: 0,
          locations: [],
          characters: [],
        },
      };

      const result = formatScreenplayForPrompt(screenplay);

      expect(result).toBe('');
    });

    it('should handle scene with empty dialogue array', () => {
      const screenplay: ScreenplayData = {
        scenes: [
          {
            number: 1,
            heading: 'INT./EXT. FOREST - DUSK',
            location: 'Forest',
            timeOfDay: 'dusk',
            estimatedDuration: 0,
            description: 'A quiet forest at twilight.',
            dialogue: [],
          },
        ],
        metadata: {
          totalScenes: 1,
          estimatedDuration: 0,
          locations: ['Forest'],
          characters: [],
        },
      };

      const result = formatScreenplayForPrompt(screenplay);

      expect(result).toContain('INT./EXT. FOREST - DUSK');
      expect(result).toContain('A quiet forest at twilight.');
      // Should not throw or have extra formatting issues
      expect(result.split('\n').filter((line) => line.trim()).length).toBe(2);
    });

    it('should trim the output', () => {
      const screenplay: ScreenplayData = {
        scenes: [
          {
            number: 1,
            heading: 'INT./EXT. ROOM - DAY',
            location: 'Room',
            timeOfDay: 'day',
            estimatedDuration: 0,
            description: 'A room.',
            dialogue: [],
          },
        ],
        metadata: {
          totalScenes: 1,
          estimatedDuration: 0,
          locations: ['Room'],
          characters: [],
        },
      };

      const result = formatScreenplayForPrompt(screenplay);

      expect(result).toBe(result.trim());
      expect(result.startsWith(' ')).toBe(false);
      expect(result.endsWith(' ')).toBe(false);
    });
  });

  describe('formatStoryForPrompt', () => {
    it('should format story with premise and full story', () => {
      const story: StoryData = {
        premise: 'A young astronaut discovers an alien artifact.',
        fullStory:
          'Maya was always fascinated by space. One day, during a routine mission, she stumbled upon something extraordinary.',
      };

      const result = formatStoryForPrompt(story);

      expect(result).toContain('PREMISE:');
      expect(result).toContain(
        'A young astronaut discovers an alien artifact.',
      );
      expect(result).toContain('STORY:');
      expect(result).toContain('Maya was always fascinated by space.');
    });

    it('should handle story with only premise', () => {
      const story: StoryData = {
        premise: 'Two friends embark on an adventure.',
      };

      const result = formatStoryForPrompt(story);

      expect(result).toContain('PREMISE:');
      expect(result).toContain('Two friends embark on an adventure.');
      expect(result).not.toContain('STORY:');
    });

    it('should handle story with only full story', () => {
      const story: StoryData = {
        fullStory:
          'The journey began on a cold winter morning. Snow covered everything.',
      };

      const result = formatStoryForPrompt(story);

      expect(result).not.toContain('PREMISE:');
      expect(result).toContain('STORY:');
      expect(result).toContain('The journey began on a cold winter morning.');
    });

    it('should handle empty story data', () => {
      const story: StoryData = {};

      const result = formatStoryForPrompt(story);

      expect(result).toBe('');
    });

    it('should trim the output', () => {
      const story: StoryData = {
        premise: 'A premise.',
        fullStory: 'A story.',
      };

      const result = formatStoryForPrompt(story);

      expect(result).toBe(result.trim());
      expect(result.startsWith(' ')).toBe(false);
      expect(result.endsWith(' ')).toBe(false);
    });

    it('should handle story with metadata fields (ignored)', () => {
      const story: StoryData = {
        title: 'The Adventure',
        logline: 'An epic tale',
        premise: 'Two heroes save the world.',
        fullStory: 'It all started...',
        generatedAt: '2024-01-01T00:00:00Z',
        generatedBy: {
          model: 'test-model',
          provider: 'test-provider',
          costCents: 100,
        },
      };

      const result = formatStoryForPrompt(story);

      // Only premise and fullStory should be in output
      expect(result).toContain('PREMISE:');
      expect(result).toContain('Two heroes save the world.');
      expect(result).toContain('STORY:');
      expect(result).toContain('It all started...');
      // Should not contain title, logline, or metadata
      expect(result).not.toContain('The Adventure');
      expect(result).not.toContain('An epic tale');
      expect(result).not.toContain('2024-01-01');
      expect(result).not.toContain('test-model');
    });

    it('should preserve newlines in story content', () => {
      const story: StoryData = {
        fullStory: 'Line one.\nLine two.\nLine three.',
      };

      const result = formatStoryForPrompt(story);

      expect(result).toContain('Line one.\nLine two.\nLine three.');
    });
  });
});
