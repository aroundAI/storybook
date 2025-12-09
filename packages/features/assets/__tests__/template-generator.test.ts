/**
 * Template Generator Tests (FILM-209)
 */
import { describe, expect, it } from 'vitest';

import { generateWithTemplate } from '../src/lib/element-prompt/template-generator';
import type { Character } from '../src/lib/types/character.types';

describe('generateWithTemplate', () => {
  const createMockCharacter = (
    overrides: Partial<Character> = {},
  ): Character => ({
    id: 'char-123',
    projectId: 'proj-456',
    name: 'Test Character',
    type: 'character',
    description: null,
    fileUrl: null,
    thumbnailUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    voiceAssetId: null,
    physicalAttributes: null,
    personality: null,
    clothing: null,
    backstory: null,
    elementPrompt: null,
    referenceImages: null,
    ...overrides,
  });

  describe('basic prompt generation', () => {
    it('should generate a prompt from full character data', () => {
      const character = createMockCharacter({
        name: 'John Doe',
        physicalAttributes: {
          age: 35,
          gender: 'male',
          ethnicity: 'Caucasian',
          build: 'athletic',
          skinTone: 'fair',
          hairColor: 'brown',
          hairStyle: 'short',
          eyeColor: 'blue',
        },
        clothing: {
          defaultOutfit: 'black leather jacket over a white t-shirt',
          style: 'casual',
          accessories: ['silver watch', 'aviator sunglasses'],
        },
      });

      const result = generateWithTemplate(character, 'realistic');

      expect(result).toContain('35-year-old');
      expect(result).toContain('Caucasian');
      expect(result).toContain('male');
      expect(result).toContain('athletic');
      expect(result).toContain('fair skin tone');
      expect(result).toContain('brown');
      expect(result).toContain('blue eyes');
      expect(result).toContain('leather jacket');
      expect(result).toContain('silver watch');
    });

    it('should handle minimal character data', () => {
      const character = createMockCharacter({
        name: 'Minimal Character',
      });

      const result = generateWithTemplate(character, 'realistic');

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain('distinct appearance');
    });

    it('should use character description as fallback', () => {
      const character = createMockCharacter({
        name: 'Described Character',
        description: 'A mysterious figure in a dark cloak',
      });

      const result = generateWithTemplate(character, 'realistic');

      expect(result).toContain('mysterious figure');
    });
  });

  describe('age handling', () => {
    it('should include numeric age when provided', () => {
      const character = createMockCharacter({
        physicalAttributes: {
          age: 28,
          gender: 'female',
        },
      });

      const result = generateWithTemplate(character, 'realistic');

      expect(result).toContain('28-year-old');
    });

    it('should use age range when no specific age', () => {
      const character = createMockCharacter({
        physicalAttributes: {
          ageRange: 'young_adult',
          gender: 'male',
        },
      });

      const result = generateWithTemplate(character, 'realistic');

      expect(result).toContain('young adult');
    });

    it('should prefer numeric age over age range', () => {
      const character = createMockCharacter({
        physicalAttributes: {
          age: 45,
          ageRange: 'young_adult',
          gender: 'female',
        },
      });

      const result = generateWithTemplate(character, 'realistic');

      expect(result).toContain('45-year-old');
      expect(result).not.toContain('young adult');
    });
  });

  describe('build description', () => {
    it('should use "an" before "average" build', () => {
      const character = createMockCharacter({
        physicalAttributes: {
          gender: 'male',
          build: 'average',
        },
      });

      const result = generateWithTemplate(character, 'realistic');

      expect(result).toContain('an average build');
    });

    it('should use "a" before other build types', () => {
      const character = createMockCharacter({
        physicalAttributes: {
          gender: 'female',
          build: 'athletic',
        },
      });

      const result = generateWithTemplate(character, 'realistic');

      expect(result).toContain('a athletic build');
    });
  });

  describe('hair and eyes', () => {
    it('should combine hair style and color', () => {
      const character = createMockCharacter({
        physicalAttributes: {
          gender: 'female',
          hairStyle: 'long, wavy',
          hairColor: 'auburn',
        },
      });

      const result = generateWithTemplate(character, 'realistic');

      expect(result).toContain('long, wavy');
      expect(result).toContain('auburn');
      expect(result).toContain('hair');
    });

    it('should handle only hair color', () => {
      const character = createMockCharacter({
        physicalAttributes: {
          gender: 'male',
          hairColor: 'black',
        },
      });

      const result = generateWithTemplate(character, 'realistic');

      expect(result).toContain('black');
      expect(result).toContain('hair');
    });

    it('should include eye color', () => {
      const character = createMockCharacter({
        physicalAttributes: {
          gender: 'female',
          eyeColor: 'green',
        },
      });

      const result = generateWithTemplate(character, 'realistic');

      expect(result).toContain('green eyes');
    });

    it('should combine hair and eye descriptions', () => {
      const character = createMockCharacter({
        physicalAttributes: {
          gender: 'male',
          hairColor: 'blonde',
          eyeColor: 'blue',
        },
      });

      const result = generateWithTemplate(character, 'realistic');

      expect(result).toContain('blonde');
      expect(result).toContain('hair');
      expect(result).toContain('blue eyes');
    });
  });

  describe('facial hair', () => {
    it('should include facial hair description', () => {
      const character = createMockCharacter({
        physicalAttributes: {
          gender: 'male',
          facialHair: 'full beard',
        },
      });

      const result = generateWithTemplate(character, 'realistic');

      expect(result).toContain('full beard');
    });
  });

  describe('distinctive features', () => {
    it('should include distinctive features', () => {
      const character = createMockCharacter({
        physicalAttributes: {
          gender: 'female',
          distinctiveFeatures: ['scar above left eyebrow', 'birthmark on neck'],
        },
      });

      const result = generateWithTemplate(character, 'realistic');

      expect(result).toContain('Notable features');
      expect(result).toContain('scar above left eyebrow');
      expect(result).toContain('birthmark on neck');
    });

    it('should skip empty distinctive features array', () => {
      const character = createMockCharacter({
        physicalAttributes: {
          gender: 'male',
          distinctiveFeatures: [],
        },
      });

      const result = generateWithTemplate(character, 'realistic');

      expect(result).not.toContain('Notable features');
    });
  });

  describe('clothing', () => {
    it('should include default outfit', () => {
      const character = createMockCharacter({
        clothing: {
          defaultOutfit: 'tailored navy suit with silk tie',
        },
      });

      const result = generateWithTemplate(character, 'realistic');

      expect(result).toContain('Typically wears');
      expect(result).toContain('tailored navy suit');
    });

    it('should include clothing style with outfit', () => {
      const character = createMockCharacter({
        clothing: {
          defaultOutfit: 'vintage dress',
          style: 'vintage',
        },
      });

      const result = generateWithTemplate(character, 'realistic');

      expect(result).toContain('vintage dress');
      expect(result).toContain('vintage style');
    });

    it('should handle style-only clothing', () => {
      const character = createMockCharacter({
        clothing: {
          style: 'formal',
        },
      });

      const result = generateWithTemplate(character, 'realistic');

      expect(result).toContain('Dresses in a formal style');
    });

    it('should include accessories', () => {
      const character = createMockCharacter({
        clothing: {
          accessories: [
            'gold necklace',
            'diamond earrings',
            'designer handbag',
          ],
        },
      });

      const result = generateWithTemplate(character, 'realistic');

      expect(result).toContain('Often seen with');
      expect(result).toContain('gold necklace');
      expect(result).toContain('diamond earrings');
      expect(result).toContain('designer handbag');
    });
  });

  describe('gender handling', () => {
    it('should include specified gender', () => {
      const character = createMockCharacter({
        physicalAttributes: {
          gender: 'female',
        },
      });

      const result = generateWithTemplate(character, 'realistic');

      expect(result).toContain('female');
    });

    it('should default to "person" when no gender specified', () => {
      const character = createMockCharacter({
        physicalAttributes: {
          age: 30,
        },
      });

      const result = generateWithTemplate(character, 'realistic');

      expect(result).toContain('person');
    });

    it('should handle non-binary gender', () => {
      const character = createMockCharacter({
        physicalAttributes: {
          gender: 'non_binary',
        },
      });

      const result = generateWithTemplate(character, 'realistic');

      expect(result).toContain('non_binary');
    });
  });

  describe('complete character example', () => {
    it('should generate comprehensive prompt for fully specified character', () => {
      const character = createMockCharacter({
        name: 'Detective Sarah Chen',
        physicalAttributes: {
          age: 38,
          gender: 'female',
          ethnicity: 'East Asian',
          build: 'athletic',
          skinTone: 'light',
          hairColor: 'black',
          hairStyle: 'shoulder-length, straight',
          eyeColor: 'dark brown',
          facialHair: undefined,
          distinctiveFeatures: ['small scar on chin', 'wears reading glasses'],
        },
        clothing: {
          defaultOutfit:
            'tailored gray blazer over white blouse with dark slacks',
          style: 'formal',
          accessories: [
            'silver watch',
            'detective badge',
            'small pearl earrings',
          ],
        },
      });

      const result = generateWithTemplate(character, 'realistic');

      // Check all major elements are present
      expect(result).toContain('38-year-old');
      expect(result).toContain('East Asian');
      expect(result).toContain('female');
      expect(result).toContain('athletic');
      expect(result).toContain('light skin tone');
      expect(result).toContain('black');
      expect(result).toContain('shoulder-length, straight');
      expect(result).toContain('dark brown eyes');
      expect(result).toContain('scar on chin');
      expect(result).toContain('reading glasses');
      expect(result).toContain('gray blazer');
      expect(result).toContain('formal style');
      expect(result).toContain('silver watch');
    });
  });
});
