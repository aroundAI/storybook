/**
 * Template Generator (FILM-209)
 * Fallback template-based prompt generation when LLM is unavailable
 */
import type { Character } from '../types/character.types';

/**
 * Generates an element prompt using a structured template
 * Used as fallback when LLM generation fails or is unavailable
 */
export function generateWithTemplate(
  character: Character,
  _style: string,
): string {
  const parts: string[] = [];

  const attrs = character.physicalAttributes;

  // Build introduction
  let intro = '';
  if (attrs?.age) {
    intro = `A ${attrs.age}-year-old`;
  } else if (attrs?.ageRange) {
    intro = `A ${attrs.ageRange.replace('_', ' ')}`;
  } else {
    intro = 'A';
  }

  if (attrs?.ethnicity) intro += ` ${attrs.ethnicity}`;
  if (attrs?.gender) intro += ` ${attrs.gender}`;
  else intro += ' person';

  if (attrs?.build) {
    intro += ` with ${attrs.build === 'average' ? 'an' : 'a'} ${attrs.build} build`;
  }

  if (attrs?.skinTone) {
    intro += ` and ${attrs.skinTone} skin tone`;
  }

  parts.push(intro + '.');

  // Hair and eyes
  const hairParts: string[] = [];
  if (attrs?.hairStyle || attrs?.hairColor) {
    let hairDesc = 'Has';
    if (attrs?.hairStyle) hairDesc += ` ${attrs.hairStyle}`;
    if (attrs?.hairColor) hairDesc += ` ${attrs.hairColor}`;
    hairDesc += ' hair';
    hairParts.push(hairDesc);
  }

  if (attrs?.eyeColor) {
    hairParts.push(`${attrs.eyeColor} eyes`);
  }

  if (hairParts.length > 0) {
    parts.push(hairParts.join(' and ') + '.');
  }

  // Facial hair
  if (attrs?.facialHair) {
    parts.push(`Has ${attrs.facialHair}.`);
  }

  // Distinctive features
  if (attrs?.distinctiveFeatures && attrs.distinctiveFeatures.length > 0) {
    parts.push(
      `Notable features include ${attrs.distinctiveFeatures.join(', ')}.`,
    );
  }

  // Clothing
  const clothing = character.clothing;
  if (clothing?.defaultOutfit) {
    let clothingDesc = `Typically wears ${clothing.defaultOutfit}`;
    if (clothing.style) {
      clothingDesc += `, reflecting a ${clothing.style} style`;
    }
    parts.push(clothingDesc + '.');
  } else if (clothing?.style) {
    parts.push(`Dresses in a ${clothing.style} style.`);
  }

  // Accessories
  if (clothing?.accessories && clothing.accessories.length > 0) {
    parts.push(`Often seen with ${clothing.accessories.join(', ')}.`);
  }

  // If we have very little content, add a generic description
  if (parts.length <= 1) {
    if (character.description) {
      parts.push(character.description);
    } else {
      parts.push(
        'This character has a distinct appearance suitable for video generation.',
      );
    }
  }

  return parts.join(' ');
}
