/**
 * LLM-based Element Prompt Generator (FILM-209)
 * Generates character element prompts using LLM
 */
import 'server-only';

import { LLMError, createLLMClient } from '@kit/llm';
import { getLogger } from '@kit/shared/logger';

import type { Character } from '../types/character.types';
import { KLING_GUIDELINES } from './kling-guidelines';

/**
 * Style options for prompt generation
 */
export type PromptStyle = 'realistic' | 'animated' | 'cinematic';

/**
 * Generates an element prompt using LLM
 * Falls back gracefully on LLM errors
 */
export async function generateWithLLM(
  character: Character,
  style: PromptStyle = 'realistic',
  includeBackstory: boolean = false,
): Promise<string | null> {
  const logger = await getLogger();
  const ctx = {
    name: 'llm-generator',
    characterId: character.id,
    characterName: character.name,
    style,
  };

  try {
    const llm = createLLMClient();

    // Build character context
    const characterContext = buildCharacterContext(character, includeBackstory);

    const styleGuide = getStyleGuide(style);

    const response = await llm.createChatCompletion({
      messages: [
        {
          role: 'system',
          content: `You are an expert at writing element prompts for Kling AI video generation.

${KLING_GUIDELINES}

Style: ${styleGuide}

Your task is to generate a concise, visually descriptive element prompt for video generation. Focus ONLY on physical appearance and clothing. Do NOT include personality traits, emotions, or backstory.

Output ONLY the prompt text, nothing else.`,
        },
        {
          role: 'user',
          content: `Generate an element prompt for this character:

${characterContext}`,
        },
      ],
      temperature: 0.7,
      maxTokens: 300,
    });

    const prompt = response.message.content.trim();

    logger.info(
      {
        ...ctx,
        promptLength: prompt.length,
        wordCount: prompt.split(/\s+/).length,
        tokens: response.usage.totalTokens,
      },
      'LLM prompt generated',
    );

    return prompt;
  } catch (error) {
    if (error instanceof LLMError) {
      logger.warn(
        { ...ctx, error: error.message, code: error.code },
        'LLM generation failed',
      );
    } else {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        { ...ctx, error: errorMessage },
        'Unexpected error in LLM generation',
      );
    }
    return null;
  }
}

/**
 * Build character context from metadata
 */
function buildCharacterContext(
  character: Character,
  includeBackstory: boolean,
): string {
  const parts: string[] = [];

  parts.push(`Name: ${character.name}`);

  if (character.description) {
    parts.push(`Description: ${character.description}`);
  }

  const attrs = character.physicalAttributes;
  if (attrs) {
    const physicalParts: string[] = [];

    if (attrs.age) physicalParts.push(`Age: ${attrs.age}`);
    if (attrs.ageRange) physicalParts.push(`Age Range: ${attrs.ageRange}`);
    if (attrs.gender) physicalParts.push(`Gender: ${attrs.gender}`);
    if (attrs.ethnicity) physicalParts.push(`Ethnicity: ${attrs.ethnicity}`);
    if (attrs.build) physicalParts.push(`Build: ${attrs.build}`);
    if (attrs.height) physicalParts.push(`Height: ${attrs.height}`);
    if (attrs.hairColor) physicalParts.push(`Hair Color: ${attrs.hairColor}`);
    if (attrs.hairStyle) physicalParts.push(`Hair Style: ${attrs.hairStyle}`);
    if (attrs.eyeColor) physicalParts.push(`Eye Color: ${attrs.eyeColor}`);
    if (attrs.skinTone) physicalParts.push(`Skin Tone: ${attrs.skinTone}`);
    if (attrs.facialHair)
      physicalParts.push(`Facial Hair: ${attrs.facialHair}`);
    if (attrs.distinctiveFeatures && attrs.distinctiveFeatures.length > 0) {
      physicalParts.push(
        `Distinctive Features: ${attrs.distinctiveFeatures.join(', ')}`,
      );
    }

    if (physicalParts.length > 0) {
      parts.push(`Physical Attributes:\n${physicalParts.join('\n')}`);
    }
  }

  const clothing = character.clothing;
  if (clothing) {
    const clothingParts: string[] = [];

    if (clothing.defaultOutfit) {
      clothingParts.push(`Default Outfit: ${clothing.defaultOutfit}`);
    }
    if (clothing.style) clothingParts.push(`Style: ${clothing.style}`);
    if (clothing.colors && clothing.colors.length > 0) {
      clothingParts.push(`Colors: ${clothing.colors.join(', ')}`);
    }
    if (clothing.accessories && clothing.accessories.length > 0) {
      clothingParts.push(`Accessories: ${clothing.accessories.join(', ')}`);
    }

    if (clothingParts.length > 0) {
      parts.push(`Clothing:\n${clothingParts.join('\n')}`);
    }
  }

  if (includeBackstory && character.backstory) {
    parts.push(
      `Backstory (for context, do not include directly): ${character.backstory}`,
    );
  }

  return parts.join('\n\n');
}

/**
 * Get style-specific guidance
 */
function getStyleGuide(style: PromptStyle): string {
  switch (style) {
    case 'animated':
      return 'Use language appropriate for animated/stylized visuals. Emphasize bold features and distinctive characteristics.';
    case 'cinematic':
      return 'Use cinematic language with dramatic lighting descriptions. Emphasize professional, film-quality appearance.';
    case 'realistic':
    default:
      return 'Use precise, realistic descriptions. Focus on photorealistic details and natural appearance.';
  }
}
