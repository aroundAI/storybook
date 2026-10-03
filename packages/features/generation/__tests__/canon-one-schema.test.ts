/**
 * FILM-1901: the canon-extraction reply has one schema. The story stage's
 * `canonFacts` and the episode_summary stage's output are read from the same
 * field definitions, so a reply the prompt can return parses in both, and
 * each stage keeps the strictness it had.
 */
import { describe, expect, it } from 'vitest';

import {
  CanonExtractionOutputSchema,
  StoryCanonFactsSchema,
} from '@kit/prompt-engine/schemas';

import { CanonExtractionSchema } from '../src/canon';
import { StoryStageOutputSchema } from '../src/stages/story';

const reply = {
  immutableEvents: [
    {
      type: 'death',
      eventKey: 'mara-dies',
      description: 'Mara dies',
      confidence: 'high',
    },
  ],
  characterStateChanges: [
    {
      characterName: 'Mara',
      stateType: 'emotional',
      fromState: 'calm',
      toState: 'afraid',
      triggerEvent: 'the fall',
    },
  ],
  threadUpdates: [
    {
      threadName: 'The lost key',
      threadType: 'mystery',
      action: 'open',
      description: 'A key goes missing',
      promises: ['It is found'],
    },
  ],
  episodeSummary: 'Mara loses the key.',
  sentimentScore: 0.4,
  keyEvents: ['The key is lost'],
  worldState: { location: 'The harbour', atmosphere: 'tense' },
};

describe('one canon-extraction schema', () => {
  it('parses the same reply in both stages', () => {
    const full = CanonExtractionOutputSchema.safeParse({ extraction: reply });
    const story = CanonExtractionSchema.safeParse(reply);

    expect(full.success).toBe(true);
    expect(story.success).toBe(true);
    expect(CanonExtractionSchema).toBe(StoryCanonFactsSchema);

    if (!full.success || !story.success) return;

    expect(story.data.episodeSummary).toBe(full.data.extraction.episodeSummary);
    expect(story.data.sentimentScore).toBe(full.data.extraction.sentimentScore);
    expect(story.data.threadUpdates).toEqual(
      full.data.extraction.threadUpdates,
    );
    expect(story.data.worldState).toEqual(full.data.extraction.worldState);
    expect(story.data.keyEvents).toEqual(full.data.extraction.keyEvents);
    expect(story.data).not.toHaveProperty('immutableEvents');
  });

  it('is the block the story stage output carries', () => {
    expect(StoryStageOutputSchema.shape.canonFacts.unwrap()).toBe(
      StoryCanonFactsSchema,
    );
  });

  it('keeps the story block strict where the full schema defaults', () => {
    const sparse = {};

    expect(
      CanonExtractionOutputSchema.safeParse({ extraction: sparse }).success,
    ).toBe(true);
    expect(CanonExtractionSchema.safeParse(sparse).success).toBe(false);
    expect(
      CanonExtractionSchema.safeParse({ ...reply, sentimentScore: 1.5 })
        .success,
    ).toBe(false);
    expect(
      CanonExtractionSchema.safeParse({ ...reply, worldState: {} }).success,
    ).toBe(false);
    expect(
      CanonExtractionOutputSchema.safeParse({
        extraction: { ...reply, worldState: {} },
      }).success,
    ).toBe(true);
    expect(
      CanonExtractionSchema.safeParse({
        ...reply,
        threadUpdates: [{ ...reply.threadUpdates[0], threadName: '' }],
      }).success,
    ).toBe(false);
  });

  it('accepts a state change without the prompt-only fields in the story block', () => {
    const lean = {
      ...reply,
      characterStateChanges: [
        { characterName: 'Mara', fromState: 'calm', toState: 'afraid' },
      ],
    };

    expect(CanonExtractionSchema.safeParse(lean).success).toBe(true);
    expect(
      CanonExtractionOutputSchema.safeParse({ extraction: lean }).success,
    ).toBe(false);
  });
});
