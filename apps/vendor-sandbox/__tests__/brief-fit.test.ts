import { describe, expect, it } from 'vitest';

import {
  jsonArrayAfter,
  wordFloorFromPrompt,
} from '../src/llm/generate/brief-fit';
import {
  castFromPrompt,
  locationsFromPrompt,
} from '../src/llm/generate/context';
import { loadCatalog } from '../src/llm/prompts';
import { respondToPrompt } from '../src/llm/respond';
import { createRng } from '../src/rng';

/**
 * A model reads the brief (FILM-1902): the stage that receives a reply
 * checks it against what it asked for. Each fitter is run here through
 * `respondToPrompt`, over many seeds, against a prompt carrying the
 * constraint, and the reply must honour it every time.
 */

const catalog = loadCatalog();
const SEEDS = 40;

function reply(key: string, userPrompt: string, seed: number) {
  const prompt = catalog.find((p) => p.key === key)!;
  const text = respondToPrompt(prompt, userPrompt, createRng(seed)).text;
  return JSON.parse(text.replace(/^```json\n|\n```$/g, '')) as Record<
    string,
    unknown
  >;
}

describe('the places a prompt names', () => {
  it('are read from the inline and the bulleted forms', () => {
    expect(
      locationsFromPrompt('**Locations**: Observation Deck, Pier Nine'),
    ).toEqual(['Observation Deck', 'Pier Nine']);
    expect(
      locationsFromPrompt(
        [
          '**LOCATIONS**:',
          '**Locations**:',
          '- **Observation Deck** (interior): Glass and starlight',
          '- The Market: a busy square',
          '',
          '- **Not A Place** (after the blank line)',
        ].join('\n'),
      ),
    ).toEqual(['Observation Deck', 'The Market']);
  });

  it('are never taken for characters', () => {
    expect(
      castFromPrompt(
        [
          '  Name: Maya',
          '**Locations**:',
          '- **Observation Deck** (interior): Glass and starlight',
        ].join('\n'),
      ),
    ).toEqual(['Maya']);
  });
});

describe('the brief helpers', () => {
  it('read a word range and a JSON array after a marker', () => {
    expect(wordFloorFromPrompt('1. **Length**: 600-900 words (for 300s)')).toBe(
      600,
    );
    expect(wordFloorFromPrompt('no range here')).toBeUndefined();
    expect(
      jsonArrayAfter('## SHOT SEQUENCE\n[{"seq":1}]\n## NEXT', /SHOT SEQUENCE/),
    ).toEqual([{ seq: 1 }]);
    expect(
      jsonArrayAfter('## SHOT SEQUENCE\n[not json]', /SHOT SEQUENCE/),
    ).toBeUndefined();
  });
});

describe('each fitted prompt honours its brief', () => {
  it('story-generation: the story is as long as the word range asks', () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const { story } = reply(
        'story-generation',
        'Name: Maya Chen\n1. **Length**: 600-900 words',
        seed,
      ) as { story: { fullText: string } };
      expect(
        story.fullText.split(/\s+/).filter(Boolean).length,
      ).toBeGreaterThanOrEqual(600);
    }
  });

  it('screenplay-refinement: scenes run 1, 2, 3, in the named places, and metadata declares what is used', () => {
    const user = [
      '  Name: Maya',
      '  Name: Houston',
      '**Locations**:',
      '- **Observation Deck** (interior): Glass and starlight',
      '- **Airlock** (interior): Cold metal',
    ].join('\n');

    for (let seed = 0; seed < SEEDS; seed++) {
      const { screenplay } = reply('screenplay-refinement', user, seed) as {
        screenplay: {
          scenes: Array<{
            number: number;
            location: string;
            dialogue: Array<{ character: string }>;
          }>;
          metadata: {
            characters: string[];
            locations: string[];
            totalScenes: number;
          };
        };
      };
      const { scenes, metadata } = screenplay;

      expect(scenes.map((s) => s.number)).toEqual(scenes.map((_, i) => i + 1));
      expect(metadata.totalScenes).toBe(scenes.length);
      for (const scene of scenes) {
        expect(['Observation Deck', 'Airlock']).toContain(scene.location);
        expect(metadata.locations).toContain(scene.location);
        for (const line of scene.dialogue) {
          expect(['Maya', 'Houston']).toContain(line.character);
          expect(metadata.characters).toContain(line.character);
        }
      }
    }
  });

  it('season-generation: every episode has its own number', () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const { episodes } = reply('season-generation', 'A roadmap.', seed) as {
        episodes: Array<{ number: number }>;
      };
      expect(episodes.map((e) => e.number)).toEqual(
        episodes.map((_, i) => i + 1),
      );
    }
  });

  it('scene-audio-refinement: every cue starts on a listed shot, inside it', () => {
    const shots = [
      { seq: 4, duration: 6 },
      { seq: 5, duration: 3 },
    ];
    const user = `## SHOT SEQUENCE\n${JSON.stringify(shots)}\n\n## INSTRUCTIONS\n1. Go.`;

    for (let seed = 0; seed < SEEDS; seed++) {
      const { cues } = reply('scene-audio-refinement', user, seed) as {
        cues: Array<{
          startShotSequence: number;
          startOffsetInShot: number;
          durationSeconds: number;
        }>;
      };
      for (const cue of cues) {
        const shot = shots.find((s) => s.seq === cue.startShotSequence);
        expect(shot).toBeDefined();
        expect(cue.startOffsetInShot).toBeGreaterThanOrEqual(0);
        expect(cue.startOffsetInShot).toBeLessThanOrEqual(shot!.duration);
        expect(cue.durationSeconds).toBeGreaterThan(0);
      }
    }
  });

  it('batch-translate-metadata: one translation per item sent, with its id and language', () => {
    const items = [
      {
        id: 'full-video-hi',
        targetLanguage: 'hi',
        title: 'A',
        description: 'B',
      },
      { id: 'short-1-de', targetLanguage: 'de', title: 'C', description: 'D' },
    ];
    const user = `Translate each of the following 2 video metadata items.\n\n${JSON.stringify(items, null, 2)}`;

    for (let seed = 0; seed < SEEDS; seed++) {
      const { translations } = reply(
        'batch-translate-metadata',
        user,
        seed,
      ) as {
        translations: Array<{
          id: string;
          targetLanguage: string;
          title: string;
        }>;
      };
      expect(translations.map((t) => [t.id, t.targetLanguage])).toEqual(
        items.map((i) => [i.id, i.targetLanguage]),
      );
      for (const t of translations) expect(t.title.trim()).not.toBe('');
    }
  });
});
