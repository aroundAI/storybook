# FILM-209: Element Prompt Generation

**Phase**: 2
**Priority**: P0
**Effort**: M (3-5 days)
**Dependencies**: FILM-202 (character actions)
**Blocks**: Phase 4 (Video Generation)

---

## Context

Element prompts are critical for AI video generation consistency. Kling AI requires structured "element" descriptions to maintain character appearance across multiple shots. This system uses LLM-based generation to convert character metadata (physical attributes, clothing, personality) into optimized element prompts that ensure visual consistency.

The element prompt generation system analyzes character details and produces concise, descriptive prompts following Kling's best practices (2-3 sentences, focus on visual details, avoid subjective descriptions).

---

## Requirements

### Functional Requirements

1. **Prompt Generation**
   - Accept Character object with all details
   - Generate element prompt (50-200 words)
   - Focus on visual attributes (appearance, clothing, distinctive features)
   - Use neutral, objective language
   - Follow Kling AI formatting guidelines

2. **LLM Integration**
   - Use OpenAI GPT-4 or Claude Sonnet for generation
   - System prompt with Kling guidelines
   - Fallback to template-based generation if LLM fails
   - Cache generated prompts to avoid redundant API calls

3. **Prompt Optimization**
   - Emphasize visual consistency keywords
   - Include age, gender, ethnicity, build
   - Describe hair, eyes, skin tone
   - Mention distinctive features (scars, tattoos, glasses)
   - Describe default outfit and style
   - Exclude personality traits (not visual)

4. **Template Fallback**
   - Structured template if LLM unavailable
   - Fill slots with character attributes
   - Ensure basic consistency
   - Log when fallback is used

5. **Validation**
   - Verify prompt length (50-200 words)
   - Check for subjective language (brave, intelligent, kind)
   - Validate visual focus
   - Return warnings if guidelines not met

### Non-Functional Requirements

- Prompt generation completes within 5 seconds
- Cache prompts for 24 hours
- Log all generated prompts for review
- Fail gracefully with template fallback
- Support batch generation (multiple characters)

---

## Interface

### Function Signature

```typescript
interface GenerateElementPromptInput {
  character: Character;
  style?: 'realistic' | 'animated' | 'cinematic';
  includeBackstory?: boolean;
}

interface GenerateElementPromptOutput {
  prompt: string;
  wordCount: number;
  warnings: string[];
  source: 'llm' | 'template';
}

/**
 * Generates an element prompt for Kling AI video generation
 * @param input Character data and generation options
 * @returns Element prompt optimized for visual consistency
 */
export async function generateElementPrompt(
  input: GenerateElementPromptInput
): Promise<GenerateElementPromptOutput>;

/**
 * Batch generate element prompts for multiple characters
 * @param characters Array of characters
 * @returns Map of character ID to element prompt
 */
export async function batchGenerateElementPrompts(
  characters: Character[],
  options?: { style?: string }
): Promise<Map<string, GenerateElementPromptOutput>>;
```

---

## Implementation

### File Structure

```
packages/features/assets/src/lib/
├── element-prompt/
│   ├── generate-element-prompt.ts      # Main generation function (CREATE THIS)
│   ├── llm-generator.ts                # LLM-based generation (CREATE THIS)
│   ├── template-generator.ts           # Template fallback (CREATE THIS)
│   ├── prompt-validator.ts             # Validation logic (CREATE THIS)
│   └── kling-guidelines.ts             # Kling best practices (CREATE THIS)
└── schemas/
    └── element-prompt.schema.ts        # Zod schemas (CREATE THIS)
```

### Main Generation Function

**File**: `packages/features/assets/src/lib/element-prompt/generate-element-prompt.ts`

```typescript
import { Character } from '../../types/character.types';
import { generateWithLLM } from './llm-generator';
import { generateWithTemplate } from './template-generator';
import { validateElementPrompt } from './prompt-validator';
import { logger } from '@kit/monitoring';

interface GenerateElementPromptInput {
  character: Character;
  style?: 'realistic' | 'animated' | 'cinematic';
  includeBackstory?: boolean;
}

interface GenerateElementPromptOutput {
  prompt: string;
  wordCount: number;
  warnings: string[];
  source: 'llm' | 'template';
}

/**
 * Generates an element prompt for Kling AI video generation
 */
export async function generateElementPrompt(
  input: GenerateElementPromptInput
): Promise<GenerateElementPromptOutput> {
  const { character, style = 'cinematic', includeBackstory = false } = input;

  try {
    // Try LLM generation first
    const llmPrompt = await generateWithLLM(character, style, includeBackstory);

    // Validate
    const validation = validateElementPrompt(llmPrompt);

    if (validation.isValid) {
      logger.info('Element prompt generated via LLM', {
        characterId: character.id,
        wordCount: validation.wordCount,
      });

      return {
        prompt: llmPrompt,
        wordCount: validation.wordCount,
        warnings: validation.warnings,
        source: 'llm',
      };
    } else {
      // LLM generation didn't meet guidelines, use template
      logger.warn('LLM prompt failed validation, falling back to template', {
        characterId: character.id,
        errors: validation.errors,
      });
    }
  } catch (error) {
    logger.error('LLM generation failed, using template fallback', {
      characterId: character.id,
      error,
    });
  }

  // Template fallback
  const templatePrompt = generateWithTemplate(character, style);
  const validation = validateElementPrompt(templatePrompt);

  return {
    prompt: templatePrompt,
    wordCount: validation.wordCount,
    warnings: validation.warnings,
    source: 'template',
  };
}

/**
 * Batch generate element prompts for multiple characters
 */
export async function batchGenerateElementPrompts(
  characters: Character[],
  options?: { style?: 'realistic' | 'animated' | 'cinematic' }
): Promise<Map<string, GenerateElementPromptOutput>> {
  const results = new Map<string, GenerateElementPromptOutput>();

  // Generate prompts in parallel
  const promises = characters.map(async (character) => {
    const output = await generateElementPrompt({
      character,
      style: options?.style,
    });
    return { characterId: character.id, output };
  });

  const settled = await Promise.allSettled(promises);

  settled.forEach((result) => {
    if (result.status === 'fulfilled') {
      results.set(result.value.characterId, result.value.output);
    } else {
      logger.error('Batch generation failed for character', {
        error: result.reason,
      });
    }
  });

  return results;
}
```

### LLM Generator

**File**: `packages/features/assets/src/lib/element-prompt/llm-generator.ts`

```typescript
import { Character } from '../../types/character.types';
import { createLLMClient } from '@kit/llm';
import { KLING_GUIDELINES } from './kling-guidelines';

const SYSTEM_PROMPT = `You are an expert at creating character element prompts for AI video generation using Kling AI.

${KLING_GUIDELINES}

Your task is to convert character metadata into a concise, visual element prompt that ensures consistency across video shots.

IMPORTANT RULES:
1. Focus ONLY on visual appearance (no personality traits)
2. Use objective, neutral language (avoid subjective descriptions like "beautiful", "handsome")
3. 2-3 sentences maximum (50-200 words)
4. Include: age, gender, ethnicity, build, hair, eyes, skin, distinctive features, clothing
5. Use present tense and third person
6. Be specific about colors, styles, and physical attributes

Example:
"A 28-year-old East Asian woman with an athletic build and light skin tone. She has long, straight black hair, brown eyes, and wears rectangular glasses. Her default outfit consists of a navy blazer, white shirt, and gray slacks, giving her a professional appearance. A small scar is visible above her left eyebrow."`;

export async function generateWithLLM(
  character: Character,
  style: string,
  includeBackstory: boolean
): Promise<string> {
  const llm = createLLMClient();

  // Build context from character data
  const context = buildCharacterContext(character, includeBackstory);

  const response = await llm.chat.completions.create({
    model: 'gpt-4',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Generate an element prompt for this character:\n\n${context}\n\nStyle: ${style}`,
      },
    ],
    temperature: 0.7,
    max_tokens: 300,
  });

  const prompt = response.choices[0]?.message?.content?.trim() ?? '';

  if (!prompt) {
    throw new Error('LLM returned empty prompt');
  }

  return prompt;
}

function buildCharacterContext(character: Character, includeBackstory: boolean): string {
  const parts: string[] = [];

  parts.push(`Name: ${character.name}`);

  if (character.description) {
    parts.push(`Description: ${character.description}`);
  }

  if (character.physicalAttributes) {
    const attrs = character.physicalAttributes;
    parts.push('\nPhysical Attributes:');

    if (attrs.age) parts.push(`- Age: ${attrs.age}`);
    if (attrs.ageRange) parts.push(`- Age Range: ${attrs.ageRange}`);
    if (attrs.gender) parts.push(`- Gender: ${attrs.gender}`);
    if (attrs.ethnicity) parts.push(`- Ethnicity: ${attrs.ethnicity}`);
    if (attrs.build) parts.push(`- Build: ${attrs.build}`);
    if (attrs.height) parts.push(`- Height: ${attrs.height}`);
    if (attrs.hairColor) parts.push(`- Hair Color: ${attrs.hairColor}`);
    if (attrs.hairStyle) parts.push(`- Hair Style: ${attrs.hairStyle}`);
    if (attrs.eyeColor) parts.push(`- Eye Color: ${attrs.eyeColor}`);
    if (attrs.skinTone) parts.push(`- Skin Tone: ${attrs.skinTone}`);
    if (attrs.facialHair) parts.push(`- Facial Hair: ${attrs.facialHair}`);
    if (attrs.distinctiveFeatures && attrs.distinctiveFeatures.length > 0) {
      parts.push(`- Distinctive Features: ${attrs.distinctiveFeatures.join(', ')}`);
    }
  }

  if (character.clothing) {
    const clothing = character.clothing;
    parts.push('\nClothing:');

    if (clothing.defaultOutfit) {
      parts.push(`- Default Outfit: ${clothing.defaultOutfit}`);
    }
    if (clothing.style) parts.push(`- Style: ${clothing.style}`);
    if (clothing.colors && clothing.colors.length > 0) {
      parts.push(`- Colors: ${clothing.colors.join(', ')}`);
    }
    if (clothing.accessories && clothing.accessories.length > 0) {
      parts.push(`- Accessories: ${clothing.accessories.join(', ')}`);
    }
  }

  if (includeBackstory && character.backstory) {
    parts.push(`\nBackstory: ${character.backstory}`);
  }

  return parts.join('\n');
}
```

### Template Generator

**File**: `packages/features/assets/src/lib/element-prompt/template-generator.ts`

```typescript
import { Character } from '../../types/character.types';

export function generateWithTemplate(character: Character, style: string): string {
  const parts: string[] = [];

  // Age and gender
  const age = character.physicalAttributes?.age ?? 'adult';
  const ageRange = character.physicalAttributes?.ageRange ?? 'adult';
  const gender = character.physicalAttributes?.gender ?? 'person';
  const ethnicity = character.physicalAttributes?.ethnicity ?? '';

  let intro = `A ${age}-year-old`;
  if (ethnicity) intro += ` ${ethnicity}`;
  intro += ` ${gender}`;

  // Build and appearance
  const build = character.physicalAttributes?.build;
  if (build) {
    intro += ` with ${build === 'average' ? 'an' : 'a'} ${build} build`;
  }

  const skinTone = character.physicalAttributes?.skinTone;
  if (skinTone) {
    intro += ` and ${skinTone} skin tone`;
  }

  parts.push(intro + '.');

  // Hair and eyes
  const hairParts: string[] = [];
  const hairColor = character.physicalAttributes?.hairColor;
  const hairStyle = character.physicalAttributes?.hairStyle;
  const eyeColor = character.physicalAttributes?.eyeColor;

  if (hairStyle || hairColor) {
    let hairDesc = 'Has';
    if (hairStyle) hairDesc += ` ${hairStyle}`;
    if (hairColor) hairDesc += ` ${hairColor}`;
    hairDesc += ' hair';
    hairParts.push(hairDesc);
  }

  if (eyeColor) {
    hairParts.push(`${eyeColor} eyes`);
  }

  if (hairParts.length > 0) {
    parts.push(hairParts.join(' and ') + '.');
  }

  // Distinctive features
  const features = character.physicalAttributes?.distinctiveFeatures;
  if (features && features.length > 0) {
    parts.push(`Notable features include ${features.join(', ')}.`);
  }

  // Clothing
  const outfit = character.clothing?.defaultOutfit;
  const clothingStyle = character.clothing?.style;

  if (outfit) {
    let clothingDesc = `Typically wears ${outfit}`;
    if (clothingStyle) {
      clothingDesc += `, reflecting a ${clothingStyle} style`;
    }
    parts.push(clothingDesc + '.');
  } else if (clothingStyle) {
    parts.push(`Dresses in a ${clothingStyle} style.`);
  }

  // Accessories
  const accessories = character.clothing?.accessories;
  if (accessories && accessories.length > 0) {
    parts.push(`Often seen with ${accessories.join(', ')}.`);
  }

  return parts.join(' ');
}
```

### Prompt Validator

**File**: `packages/features/assets/src/lib/element-prompt/prompt-validator.ts`

```typescript
interface ValidationResult {
  isValid: boolean;
  wordCount: number;
  warnings: string[];
  errors: string[];
}

const SUBJECTIVE_WORDS = [
  'beautiful',
  'handsome',
  'ugly',
  'pretty',
  'gorgeous',
  'attractive',
  'unattractive',
  'cute',
  'stunning',
];

const PERSONALITY_WORDS = [
  'brave',
  'intelligent',
  'kind',
  'mean',
  'smart',
  'clever',
  'wise',
  'foolish',
  'confident',
  'shy',
];

export function validateElementPrompt(prompt: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Word count
  const wordCount = prompt.split(/\s+/).length;

  if (wordCount < 50) {
    errors.push('Prompt is too short (minimum 50 words)');
  }

  if (wordCount > 200) {
    errors.push('Prompt is too long (maximum 200 words)');
  }

  // Check for subjective language
  const lowerPrompt = prompt.toLowerCase();
  SUBJECTIVE_WORDS.forEach((word) => {
    if (lowerPrompt.includes(word)) {
      warnings.push(`Contains subjective word: "${word}"`);
    }
  });

  // Check for personality traits
  PERSONALITY_WORDS.forEach((word) => {
    if (lowerPrompt.includes(word)) {
      warnings.push(`Contains personality trait: "${word}" (not visual)`);
    }
  });

  // Check for past tense
  if (lowerPrompt.match(/\b(was|were|had)\b/)) {
    warnings.push('Contains past tense (use present tense)');
  }

  // Check for first/second person
  if (lowerPrompt.match(/\b(i|me|my|you|your)\b/)) {
    warnings.push('Contains first/second person (use third person)');
  }

  return {
    isValid: errors.length === 0,
    wordCount,
    warnings,
    errors,
  };
}
```

### Kling Guidelines

**File**: `packages/features/assets/src/lib/element-prompt/kling-guidelines.ts`

```typescript
export const KLING_GUIDELINES = `
KLING AI ELEMENT PROMPT BEST PRACTICES:

1. Length: 50-200 words (2-3 sentences ideal)

2. Focus on Visual Appearance:
   - Age, gender, ethnicity
   - Body type and build
   - Hair color, style, length
   - Eye color
   - Skin tone
   - Distinctive features (scars, tattoos, glasses, piercings)
   - Clothing style and colors
   - Accessories

3. Language Style:
   - Use present tense
   - Use third person (he, she, they)
   - Use objective, neutral descriptions
   - Avoid subjective adjectives (beautiful, handsome, ugly)
   - Avoid personality traits (brave, intelligent, kind)

4. Specificity:
   - Be specific about colors (not "dark hair", use "black hair")
   - Mention exact styles (not "stylish", use "tailored suit")
   - Include measurable attributes (age, height ranges)

5. Consistency Keywords:
   - Use words that help maintain consistency across shots
   - "always wears", "distinctive", "signature"
   - Emphasize unique identifiers

GOOD EXAMPLE:
"A 32-year-old Caucasian man with an athletic build and fair skin. He has short, brown hair styled in a crew cut, blue eyes, and a square jawline. He wears a black leather jacket over a white t-shirt, dark jeans, and brown boots. A small scar runs through his left eyebrow, and he always wears a silver watch on his right wrist."

BAD EXAMPLE:
"A handsome young man who is very intelligent and brave. He has a great sense of style and was known for his charm. You can see confidence in his eyes."
`;
```

---

## File Changes

### New Files

1. **packages/features/assets/src/lib/element-prompt/generate-element-prompt.ts**
   - Main generation function with LLM/template fallback

2. **packages/features/assets/src/lib/element-prompt/llm-generator.ts**
   - LLM-based prompt generation

3. **packages/features/assets/src/lib/element-prompt/template-generator.ts**
   - Template-based fallback generation

4. **packages/features/assets/src/lib/element-prompt/prompt-validator.ts**
   - Validation logic for generated prompts

5. **packages/features/assets/src/lib/element-prompt/kling-guidelines.ts**
   - Kling AI best practices documentation

6. **packages/features/assets/src/lib/schemas/element-prompt.schema.ts**
   - Zod schemas for validation

### Modified Files

None (new feature)

---

## Acceptance Criteria

### Functional

- [ ] `generateElementPrompt` returns prompt for character
- [ ] LLM generation uses GPT-4 or Claude Sonnet
- [ ] System prompt includes Kling guidelines
- [ ] Prompt focuses on visual attributes only
- [ ] Prompt excludes personality traits
- [ ] Prompt uses present tense and third person
- [ ] Prompt length between 50-200 words
- [ ] Template fallback works when LLM fails
- [ ] Template fallback produces valid prompt
- [ ] Validator detects subjective language
- [ ] Validator detects personality traits
- [ ] Validator checks word count
- [ ] Batch generation processes multiple characters
- [ ] Batch generation handles partial failures
- [ ] Warnings logged for validation issues

### Non-Functional

- [ ] Prompt generation completes within 5 seconds
- [ ] LLM failures fall back gracefully
- [ ] Generated prompts cached for 24 hours
- [ ] All generations logged for review
- [ ] Batch generation runs in parallel
- [ ] TypeScript compiles without errors
- [ ] No ESLint warnings

---

## Test Plan

### Unit Tests

**File**: `packages/features/assets/src/lib/element-prompt/__tests__/generate-element-prompt.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { generateElementPrompt } from '../generate-element-prompt';
import { Character } from '../../../types/character.types';

describe('generateElementPrompt', () => {
  const mockCharacter: Character = {
    id: 'char-1',
    projectId: 'proj-1',
    name: 'John Doe',
    type: 'character',
    physicalAttributes: {
      age: 32,
      gender: 'male',
      ethnicity: 'Caucasian',
      build: 'athletic',
      hairColor: 'brown',
      hairStyle: 'short, crew cut',
      eyeColor: 'blue',
      skinTone: 'fair',
      distinctiveFeatures: ['scar on left eyebrow'],
    },
    clothing: {
      defaultOutfit: 'black leather jacket, white t-shirt, dark jeans',
      style: 'casual',
      accessories: ['silver watch'],
    },
  };

  it('should generate prompt via LLM', async () => {
    const result = await generateElementPrompt({ character: mockCharacter });

    expect(result.source).toBe('llm');
    expect(result.prompt).toContain('32-year-old');
    expect(result.wordCount).toBeGreaterThanOrEqual(50);
    expect(result.wordCount).toBeLessThanOrEqual(200);
  });

  it('should fall back to template if LLM fails', async () => {
    // Mock LLM failure
    vi.mock('@kit/llm', () => ({
      createLLMClient: () => {
        throw new Error('LLM unavailable');
      },
    }));

    const result = await generateElementPrompt({ character: mockCharacter });

    expect(result.source).toBe('template');
    expect(result.prompt).toBeTruthy();
  });

  it('should validate prompt length', async () => {
    const result = await generateElementPrompt({ character: mockCharacter });

    expect(result.wordCount).toBeGreaterThanOrEqual(50);
    expect(result.wordCount).toBeLessThanOrEqual(200);
  });

  it('should warn about subjective language', async () => {
    // Mock LLM to return subjective prompt
    const result = await generateElementPrompt({ character: mockCharacter });

    // If prompt contains "beautiful", should have warning
  });

  it('should exclude personality traits', async () => {
    const characterWithPersonality = {
      ...mockCharacter,
      personality: {
        traits: ['brave', 'intelligent'],
      },
    };

    const result = await generateElementPrompt({
      character: characterWithPersonality,
    });

    expect(result.prompt.toLowerCase()).not.toContain('brave');
    expect(result.prompt.toLowerCase()).not.toContain('intelligent');
  });
});
```

### Validator Tests

**File**: `packages/features/assets/src/lib/element-prompt/__tests__/prompt-validator.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { validateElementPrompt } from '../prompt-validator';

describe('validateElementPrompt', () => {
  it('should accept valid prompt', () => {
    const prompt =
      'A 32-year-old Caucasian man with an athletic build. He has short brown hair and blue eyes. He wears a black leather jacket and dark jeans.';

    const result = validateElementPrompt(prompt);

    expect(result.isValid).toBe(true);
    expect(result.wordCount).toBeGreaterThan(0);
  });

  it('should reject too short prompt', () => {
    const prompt = 'A man with brown hair.';

    const result = validateElementPrompt(prompt);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Prompt is too short (minimum 50 words)');
  });

  it('should warn about subjective language', () => {
    const prompt =
      'A beautiful woman with gorgeous hair and stunning eyes. She is very attractive and has a pretty smile. ' +
      'Her elegant style and handsome features make her stand out in any crowd.';

    const result = validateElementPrompt(prompt);

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes('beautiful'))).toBe(true);
  });

  it('should warn about personality traits', () => {
    const prompt =
      'A brave and intelligent man who is very kind to others. He is smart and confident, with a wise demeanor. ' +
      'His clever thinking and foolish mistakes define his character.';

    const result = validateElementPrompt(prompt);

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes('brave'))).toBe(true);
  });

  it('should warn about past tense', () => {
    const prompt =
      'A man who was known for his style. He had brown hair and was wearing a suit. ' +
      'He were seen at the party yesterday.';

    const result = validateElementPrompt(prompt);

    expect(result.warnings.some((w) => w.includes('past tense'))).toBe(true);
  });
});
```

---

## Performance Considerations

### Caching Strategy

```typescript
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

async function getCachedPrompt(characterId: string): Promise<string | null> {
  const cached = await redis.get(`element-prompt:${characterId}`);
  return cached ? (cached as string) : null;
}

async function cachePrompt(characterId: string, prompt: string): Promise<void> {
  await redis.setex(`element-prompt:${characterId}`, 86400, prompt); // 24 hours
}

export async function generateElementPromptCached(
  input: GenerateElementPromptInput
): Promise<GenerateElementPromptOutput> {
  // Check cache first
  const cached = await getCachedPrompt(input.character.id);
  if (cached) {
    return {
      prompt: cached,
      wordCount: cached.split(/\s+/).length,
      warnings: [],
      source: 'llm', // Assume cached was LLM-generated
    };
  }

  // Generate new
  const result = await generateElementPrompt(input);

  // Cache result
  await cachePrompt(input.character.id, result.prompt);

  return result;
}
```

### Batch Optimization

- Generate prompts in parallel for multiple characters
- Use Promise.allSettled to handle partial failures
- Limit concurrent LLM requests (max 5 at once)

---

## Future Enhancements

1. **Manual Editing**
   - Allow users to edit generated prompts
   - Save edited versions
   - Version history

2. **Prompt Variations**
   - Generate multiple prompt variations
   - A/B testing for best results
   - User selection of preferred prompt

3. **Visual Validation**
   - Generate test image using prompt
   - Compare to reference image
   - Score similarity

4. **Style Adaptation**
   - Anime-specific prompts
   - Photorealistic prompts
   - Fantasy/sci-fi styles

5. **Multi-Language Support**
   - Generate prompts in other languages
   - Translation for international models

---

## References

- **FILM-202**: Character actions (provides character data)
- **Kling AI Documentation**: https://docs.klingai.com/
- **@kit/llm**: LLM abstraction package
- **Constitution**: Section 2.2 (Server Actions Pattern)
