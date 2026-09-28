import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { findPlaceholders, placeholderIn } from '../src/corpus/placeholder';
import { castFromPrompt, createContext } from '../src/llm/generate/context';
import { generateFromZod } from '../src/llm/generate/zod';
import { loadCatalog } from '../src/llm/prompts';
import { respondToPrompt } from '../src/llm/respond';
import { createRng } from '../src/rng';

/**
 * "Looks real, is fictional" (phase 18 README), and random but replayable.
 * FILM-1803: no generated title, character, location or line of dialogue
 * matches a placeholder pattern, over a large sample.
 */

const catalog = loadCatalog();
const SEEDS = 200;

function parse(text: string): unknown {
  const trimmed = text.replace(/^```json\n|\n```$/g, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

describe('the placeholder check itself', () => {
  it.each([
    ['Character 1', true],
    ['character 12', false],
    ['Scene A', false],
    ['Generated story 4', false],
    ['Lorem ipsum dolor', false],
    ['Test channel', false],
    ['Sample video', false],
    ['Episode #3', false],
  ])('catches "%s"', (value, isName) => {
    expect(placeholderIn(value, isName)).not.toBeNull();
  });

  it('catches a counter on the end of a name', () => {
    expect(findPlaceholders({ characterName: 'Mara 2' })).toHaveLength(1);
    expect(findPlaceholders({ title: 'Harbor Lights 07' })).toHaveLength(1);
  });

  it.each([
    'The Stranger in Booth Four',
    'Static on Channel Nine',
    'Stay here. If I’m not back in ten minutes, call my grandmother.',
    'I found a video a friend sent me.',
    'Mara Okafor',
  ])('lets "%s" through', (value) => {
    expect(findPlaceholders({ title: value, line: value })).toEqual([]);
  });
});

describe(`every prompt, over ${SEEDS} seeds`, () => {
  it('never generates a placeholder, and places every string field', () => {
    const placeholders: string[] = [];
    const unplaced = new Set<string>();

    for (const prompt of catalog) {
      for (let seed = 0; seed < SEEDS; seed++) {
        const response = respondToPrompt(
          prompt,
          'Generate 3 unique story ideas',
          createRng(seed),
        );
        for (const found of findPlaceholders(parse(response.text))) {
          placeholders.push(
            `${prompt.key} seed ${seed}: ${found.path} = ${JSON.stringify(found.value)} (${found.rule})`,
          );
        }
        for (const field of response.unplaced)
          unplaced.add(`${prompt.key}: ${field}`);
      }
    }

    expect(placeholders.slice(0, 20)).toEqual([]);
    expect(
      [...unplaced],
      'add a rule for these fields in src/corpus/index.ts',
    ).toEqual([]);
  });
});

describe('randomness', () => {
  const prompt = catalog.find((p) => p.key === 'screenplay-conversion')!;

  it('replays byte for byte from the same seed', () => {
    const a = respondToPrompt(prompt, '', createRng(81723)).text;
    const b = respondToPrompt(prompt, '', createRng(81723)).text;
    expect(a).toBe(b);
  });

  it('differs between seeds', () => {
    const texts = new Set(
      Array.from(
        { length: 10 },
        (_, seed) => respondToPrompt(prompt, '', createRng(seed)).text,
      ),
    );
    expect(texts.size).toBe(10);
  });
});

describe('the cast a prompt names', () => {
  it('is read from every form the context builders write', () => {
    expect(
      castFromPrompt(
        [
          'CHARACTER 1 — LOCKED IDENTITY:',
          '  Name: Mara Okafor',
          '- **Theo Lindqvist** (supporting) - Reference image attached',
          '**Character Names for Dialogue**: Mara Okafor, Ines Duarte',
          'Characters: Kwame Adeyemi',
          '### Hana Sato (supporting)',
          '### Scene 3 (night)',
          'Name: the lighthouse',
        ].join('\n'),
      ),
    ).toEqual([
      'Mara Okafor',
      'Theo Lindqvist',
      'Hana Sato',
      'Ines Duarte',
      'Kwame Adeyemi',
    ]);
  });

  it('is the only cast a screenplay speaks with', () => {
    const prompt = catalog.find((p) => p.key === 'screenplay-conversion')!;
    const user =
      '**Character Names for Dialogue**: Mara Okafor, Theo Lindqvist';
    for (let seed = 0; seed < 20; seed++) {
      const data = parse(
        respondToPrompt(prompt, user, createRng(seed)).text,
      ) as {
        screenplay: {
          scenes: Array<{ dialogue: Array<{ character: string }> }>;
        };
      };
      const speakers = new Set(
        data.screenplay.scenes.flatMap((s) =>
          s.dialogue.map((d) => d.character),
        ),
      );
      expect(
        [...speakers].every((name) =>
          ['Mara Okafor', 'Theo Lindqvist'].includes(name),
        ),
      ).toBe(true);
    }
  });
});

describe('a list of characters', () => {
  it('names each cast member once, not one name over and over', () => {
    const schema = z.object({
      characters: z
        .array(z.object({ name: z.string(), role: z.string() }))
        .min(1),
    });
    for (let seed = 0; seed < 20; seed++) {
      const ctx = createContext(
        createRng(seed),
        'Characters: Mara Okafor, Theo Lindqvist',
      );
      const { characters } = generateFromZod(schema, ctx) as {
        characters: Array<{ name: string }>;
      };
      const names = characters.map((c) => c.name);
      expect(new Set(names).size, `seed ${seed}: ${names.join(', ')}`).toBe(
        names.length,
      );
      expect(
        names.every((n) => ['Mara Okafor', 'Theo Lindqvist'].includes(n)),
      ).toBe(true);
    }
  });
});

describe('consistency within one response', () => {
  it('keeps to one small cast across every character field', () => {
    const prompt = catalog.find((p) => p.key === 'screenplay-conversion')!;

    for (let seed = 0; seed < 20; seed++) {
      const names = new Set<string>();
      const walk = (value: unknown, key = '') => {
        if (
          typeof value === 'string' &&
          /^(character|speaker|charactername)$/i.test(key)
        )
          names.add(value);
        else if (Array.isArray(value)) value.forEach((v) => walk(v, key));
        else if (value && typeof value === 'object') {
          for (const [k, v] of Object.entries(value)) walk(v, k);
        }
      };
      walk(parse(respondToPrompt(prompt, '', createRng(seed)).text));

      expect(names.size).toBeGreaterThan(0);
      expect(names.size).toBeLessThanOrEqual(5);
    }
  });

  it('generates the number of items the prompt asks for', () => {
    const prompt = catalog.find((p) => p.key === 'story-ideation')!;
    for (const count of [1, 3, 5]) {
      const data = parse(
        respondToPrompt(
          prompt,
          `Generate ${count} unique story ideas based on this premise`,
          createRng(count),
        ).text,
      ) as { ideas: unknown[] };
      expect(data.ideas).toHaveLength(count);
    }
  });
});
