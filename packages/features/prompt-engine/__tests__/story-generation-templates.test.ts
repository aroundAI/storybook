import { describe, expect, it } from 'vitest';

import {
  safeValidatePromptTemplate,
  validateExampleOutput,
  validateVariablePlaceholders,
  validateZodSchemaCompilation,
} from '../src/lib/validation';
import screenplayConversion from '../src/prompts/story-generation/screenplay-conversion.json';
import shotListGeneration from '../src/prompts/story-generation/shot-list-generation.json';
import storyGeneration from '../src/prompts/story-generation/story-generation.json';
// Import the JSON templates
import storyIdeation from '../src/prompts/story-generation/story-ideation.json';
import {
  ScreenplayConversionOutputSchema,
  ShotListGenerationOutputSchema,
  StoryGenerationOutputSchema,
  StoryIdeationOutputSchema,
} from '../src/schemas';

describe('Story Generation Prompt Templates', () => {
  describe('story-ideation.json', () => {
    it('should have valid template structure', () => {
      const result = safeValidatePromptTemplate(storyIdeation);
      expect(result.success).toBe(true);
      if (!result.success) {
        console.error('Validation errors:', result.error.errors);
      }
    });

    it('should have correct metadata', () => {
      expect(storyIdeation.slug).toBe('story-ideation');
      expect(storyIdeation.version).toBe(1);
      expect(storyIdeation.category).toBe('story-generation');
    });

    it('should have required premise variable', () => {
      expect(storyIdeation.variables.premise).toBeDefined();
      expect(storyIdeation.variables.premise.required).toBe(true);
    });

    it('should have optional genre, target_audience, style, and number_of_ideas variables', () => {
      expect(storyIdeation.variables.genre?.required).toBe(false);
      expect(storyIdeation.variables.target_audience?.required).toBe(false);
      expect(storyIdeation.variables.style?.required).toBe(false);
      expect(storyIdeation.variables.number_of_ideas?.required).toBe(false);
    });

    it('should have valid output schema that compiles', () => {
      const schemaResult = validateZodSchemaCompilation(
        storyIdeation.output!.schema!.definition,
      );
      expect(schemaResult.success).toBe(true);
    });

    it('should have example output that matches schema', () => {
      const result = validateExampleOutput(storyIdeation as never);
      expect(result.success).toBe(true);
    });

    it('should have all variables used in user_prompt', () => {
      const errors = validateVariablePlaceholders(storyIdeation as never);
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
      if (!result.success) {
        console.error('Validation errors:', result.error.errors);
      }
    });

    it('should have correct metadata', () => {
      expect(storyGeneration.slug).toBe('story-generation');
      expect(storyGeneration.version).toBe(1);
      expect(storyGeneration.category).toBe('story-generation');
    });

    it('should have required title, logline, and target_duration variables', () => {
      expect(storyGeneration.variables.title.required).toBe(true);
      expect(storyGeneration.variables.logline.required).toBe(true);
      expect(storyGeneration.variables.target_duration.required).toBe(true);
    });

    it('should have optional characters, world_details, and style variables', () => {
      expect(storyGeneration.variables.characters?.required).toBe(false);
      expect(storyGeneration.variables.world_details?.required).toBe(false);
      expect(storyGeneration.variables.style?.required).toBe(false);
    });

    it('should have valid output schema that compiles', () => {
      const schemaResult = validateZodSchemaCompilation(
        storyGeneration.output!.schema!.definition,
      );
      expect(schemaResult.success).toBe(true);
    });

    it('should have example output that matches schema', () => {
      const result = validateExampleOutput(storyGeneration as never);
      expect(result.success).toBe(true);
    });

    it('should have all variables used in user_prompt', () => {
      const errors = validateVariablePlaceholders(storyGeneration as never);
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
      if (!result.success) {
        console.error('Validation errors:', result.error.errors);
      }
    });

    it('should have correct metadata', () => {
      expect(screenplayConversion.slug).toBe('screenplay-conversion');
      expect(screenplayConversion.version).toBe(1);
      expect(screenplayConversion.category).toBe('story-generation');
    });

    it('should have required story variable', () => {
      expect(screenplayConversion.variables.story.required).toBe(true);
    });

    it('should have optional target_scene_count and style variables', () => {
      expect(screenplayConversion.variables.target_scene_count?.required).toBe(
        false,
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
      const result = validateExampleOutput(screenplayConversion as never);
      expect(result.success).toBe(true);
    });

    it('should have all variables used in user_prompt', () => {
      const errors = validateVariablePlaceholders(
        screenplayConversion as never,
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

  describe('shot-list-generation.json', () => {
    it('should have valid template structure', () => {
      const result = safeValidatePromptTemplate(shotListGeneration);
      expect(result.success).toBe(true);
      if (!result.success) {
        console.error('Validation errors:', result.error.errors);
      }
    });

    it('should have correct metadata', () => {
      expect(shotListGeneration.slug).toBe('shot-list-generation');
      expect(shotListGeneration.version).toBe(1);
      expect(shotListGeneration.category).toBe('story-generation');
    });

    it('should have required screenplay_text variable', () => {
      expect(shotListGeneration.variables.screenplay_text.required).toBe(true);
    });

    it('should have optional shot duration and video provider variables', () => {
      expect(shotListGeneration.variables.shot_duration_min?.required).toBe(
        false,
      );
      expect(shotListGeneration.variables.shot_duration_max?.required).toBe(
        false,
      );
      expect(shotListGeneration.variables.video_provider?.required).toBe(false);
    });

    it('should have valid output schema that compiles', () => {
      const schemaResult = validateZodSchemaCompilation(
        shotListGeneration.output!.schema!.definition,
      );
      expect(schemaResult.success).toBe(true);
    });

    it('should have example output that matches schema', () => {
      const result = validateExampleOutput(shotListGeneration as never);
      expect(result.success).toBe(true);
    });

    it('should have all variables used in user_prompt', () => {
      const errors = validateVariablePlaceholders(shotListGeneration as never);
      expect(errors).toHaveLength(0);
    });

    it('should validate example output with TypeScript schema', () => {
      const result = ShotListGenerationOutputSchema.safeParse(
        shotListGeneration.output?.example_output,
      );
      expect(result.success).toBe(true);
    });

    it('should have constraints system prompt for AI video limitations', () => {
      const constraintsPrompt = shotListGeneration.system_prompts.find(
        (p) => p.slug === 'constraints',
      );
      expect(constraintsPrompt).toBeDefined();
      expect(constraintsPrompt?.content).toContain('3-10 seconds');
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

    it('should parse valid shot list generation output', () => {
      const output = {
        shotList: {
          shots: [
            {
              sequenceNumber: 1,
              sceneNumber: 1,
              shotNumber: 1,
              shotType: 'wide' as const,
              cameraDirection: 'static' as const,
              description: 'Wide shot of office',
              action: 'Camera holds on office scene',
              prompt:
                'Wide shot of modern office, developer at desk, ambient lighting',
              characters: ['Dev'],
              duration: 5,
              metadata: {
                location: 'office',
                timeOfDay: 'day' as const,
                mood: 'focused',
                lighting: 'natural daylight',
              },
            },
          ],
          metadata: {
            totalShots: 1,
            totalDuration: 5,
            shotTypes: {
              wide: 1,
              medium: 0,
              closeUp: 0,
            },
            locations: ['office'],
            characters: ['Dev'],
          },
        },
      };
      const result = ShotListGenerationOutputSchema.safeParse(output);
      expect(result.success).toBe(true);
    });

    it('should reject invalid shot duration outside 3-10 range', () => {
      const output = {
        shotList: {
          shots: [
            {
              sequenceNumber: 1,
              sceneNumber: 1,
              shotNumber: 1,
              shotType: 'wide' as const,
              cameraDirection: 'static' as const,
              description: 'Wide shot',
              action: 'Action',
              prompt: 'Prompt',
              characters: [],
              duration: 15, // Invalid: exceeds 10 seconds
              metadata: {
                location: 'office',
                timeOfDay: 'day' as const,
              },
            },
          ],
          metadata: {
            totalShots: 1,
            totalDuration: 15,
            shotTypes: { wide: 1, medium: 0, closeUp: 0 },
            locations: ['office'],
            characters: [],
          },
        },
      };
      const result = ShotListGenerationOutputSchema.safeParse(output);
      expect(result.success).toBe(false);
    });
  });
});
