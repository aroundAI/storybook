import { describe, expect, it } from 'vitest';

import {
  type PromptTemplateSchemaType,
  safeValidatePromptTemplate,
  validateExampleOutput,
  validateVariablePlaceholders,
  validateZodSchemaCompilation,
} from '../src/lib/validation';
import screenplayConversion from '../src/prompts/story-generation/screenplay-conversion.json';
import storyGeneration from '../src/prompts/story-generation/story-generation.json';
import storyIdeation from '../src/prompts/story-generation/story-ideation.json';
import {
  ScreenplayConversionOutputSchema,
  StoryGenerationOutputSchema,
  StoryIdeationOutputSchema,
} from '../src/schemas';

describe('Story Generation Prompt Templates', () => {
  describe('story-ideation.json', () => {
    it('should have valid template structure', () => {
      const result = safeValidatePromptTemplate(storyIdeation);
      expect(result.success).toBe(true);
    });

    it('should have correct metadata', () => {
      expect(storyIdeation.slug).toBe('story-ideation');
      expect(storyIdeation.version).toBe(2);
      expect(storyIdeation.category).toBe('story-generation');
    });

    it('should have required premise variable', () => {
      expect(storyIdeation.variables.premise).toBeDefined();
      expect(storyIdeation.variables.premise.required).toBe(true);
    });

    it('should have optional genre, target_audience, visual_style, and number_of_ideas variables', () => {
      expect(storyIdeation.variables.genre?.required).toBe(false);
      expect(storyIdeation.variables.target_audience?.required).toBe(false);
      expect(storyIdeation.variables.visual_style?.required).toBe(false);
      expect(storyIdeation.variables.number_of_ideas?.required).toBe(false);
    });

    it('should have valid output schema that compiles', () => {
      const schemaResult = validateZodSchemaCompilation(
        storyIdeation.output!.schema!.definition,
      );
      expect(schemaResult.success).toBe(true);
    });

    it('should have example output that matches schema', () => {
      const result = validateExampleOutput(
        storyIdeation as unknown as PromptTemplateSchemaType,
      );
      expect(result.success).toBe(true);
    });

    it('should have all variables used in user_prompt', () => {
      const errors = validateVariablePlaceholders(
        storyIdeation as unknown as PromptTemplateSchemaType,
      );
      expect(errors).toHaveLength(0);
    });

    it('should validate example output with TypeScript schema', () => {
      const result = StoryIdeationOutputSchema.safeParse(
        storyIdeation.output?.example_output,
      );
      expect(result.success).toBe(true);
    });
  });

  describe('story-generation.json', () => {
    it('should have valid template structure', () => {
      const result = safeValidatePromptTemplate(storyGeneration);
      expect(result.success).toBe(true);
    });

    it('should have correct metadata', () => {
      expect(storyGeneration.slug).toBe('story-generation');
      expect(storyGeneration.version).toBe(2);
      expect(storyGeneration.category).toBe('story-generation');
    });

    it('should have required title, logline, and target_duration variables', () => {
      expect(storyGeneration.variables.title.required).toBe(true);
      expect(storyGeneration.variables.logline.required).toBe(true);
      expect(storyGeneration.variables.target_duration.required).toBe(true);
    });

    it('should have optional characters and visual_style variables', () => {
      expect(storyGeneration.variables.characters?.required).toBe(false);
      expect(storyGeneration.variables.visual_style?.required).toBe(false);
    });

    it('should have valid output schema that compiles', () => {
      const schemaResult = validateZodSchemaCompilation(
        storyGeneration.output!.schema!.definition,
      );
      expect(schemaResult.success).toBe(true);
    });

    it('should have example output that matches schema', () => {
      const result = validateExampleOutput(
        storyGeneration as unknown as PromptTemplateSchemaType,
      );
      expect(result.success).toBe(true);
    });

    it('should have all variables used in user_prompt', () => {
      const errors = validateVariablePlaceholders(
        storyGeneration as unknown as PromptTemplateSchemaType,
      );
      expect(errors).toHaveLength(0);
    });

    it('should validate example output with TypeScript schema', () => {
      const result = StoryGenerationOutputSchema.safeParse(
        storyGeneration.output?.example_output,
      );
      expect(result.success).toBe(true);
    });
  });

  describe('screenplay-conversion.json', () => {
    it('should have valid template structure', () => {
      const result = safeValidatePromptTemplate(screenplayConversion);
      expect(result.success).toBe(true);
    });

    it('should have correct metadata', () => {
      expect(screenplayConversion.slug).toBe('screenplay-conversion');
      expect(screenplayConversion.version).toBe(2);
      expect(screenplayConversion.category).toBe('story-generation');
    });

    it('should have required story variable', () => {
      expect(screenplayConversion.variables.story.required).toBe(true);
    });

    it('should have required scene_count and optional style variables', () => {
      expect(screenplayConversion.variables.scene_count_min?.required).toBe(
        true,
      );
      expect(screenplayConversion.variables.scene_count_max?.required).toBe(
        true,
      );
      expect(screenplayConversion.variables.style?.required).toBe(false);
    });

    it('should have valid output schema that compiles', () => {
      const schemaResult = validateZodSchemaCompilation(
        screenplayConversion.output!.schema!.definition,
      );
      expect(schemaResult.success).toBe(true);
    });

    it('should have example output that matches schema', () => {
      const result = validateExampleOutput(
        screenplayConversion as unknown as PromptTemplateSchemaType,
      );
      expect(result.success).toBe(true);
    });

    it('should have all variables used in user_prompt', () => {
      const errors = validateVariablePlaceholders(
        screenplayConversion as unknown as PromptTemplateSchemaType,
      );
      expect(errors).toHaveLength(0);
    });

    it('should validate example output with TypeScript schema', () => {
      const result = ScreenplayConversionOutputSchema.safeParse(
        screenplayConversion.output?.example_output,
      );
      expect(result.success).toBe(true);
    });
  });

  describe('Zod Output Schemas', () => {
    it('should parse valid story ideation output', () => {
      const output = {
        ideas: [
          {
            title: 'Test Story',
            logline: 'A test story about testing',
            themes: ['testing', 'code'],
            hook: 'What if tests could dream?',
            visualPotential: 'Great for animation',
          },
        ],
      };
      const result = StoryIdeationOutputSchema.safeParse(output);
      expect(result.success).toBe(true);
    });

    it('should parse valid story generation output', () => {
      const output = {
        story: {
          title: 'Test Story',
          fullText: 'Once upon a time in a land of code...',
          actBreakdown: {
            act1: 'Setup',
            act2: 'Confrontation',
            act3: 'Resolution',
          },
          characters: [
            {
              name: 'Dev',
              role: 'protagonist' as const,
              arc: 'From confusion to clarity',
            },
          ],
          themes: ['testing'],
          tone: 'playful',
          estimatedSceneCount: 5,
          episodeSummary:
            'A developer embarks on a journey through code, learning valuable lessons about testing.',
          sentimentScore: 0.7,
          keyEvents: ['Dev discovers a bug', 'Dev writes tests', 'Tests pass'],
        },
      };
      const result = StoryGenerationOutputSchema.safeParse(output);
      expect(result.success).toBe(true);
    });

    it('should parse valid screenplay conversion output', () => {
      const output = {
        screenplay: {
          scenes: [
            {
              number: 1,
              heading: 'INT. OFFICE - DAY',
              location: 'office',
              timeOfDay: 'day' as const,
              description: 'A developer sits at their desk.',
              dialogue: [
                {
                  character: 'DEV',
                  text: 'Time to write some tests.',
                },
              ],
              estimatedDuration: 30,
            },
          ],
          metadata: {
            totalScenes: 1,
            estimatedDuration: 30,
            locations: ['office'],
            characters: ['Dev'],
          },
        },
      };
      const result = ScreenplayConversionOutputSchema.safeParse(output);
      expect(result.success).toBe(true);
    });
  });
});
