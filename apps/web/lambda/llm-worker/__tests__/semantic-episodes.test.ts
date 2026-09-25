import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_DOCUMENT_CHARS,
  contentHash,
  embedderOrLog,
  episodeDocument,
  episodesNeedingEmbedding,
  resetSemanticLogLatch,
  withSequentialFallback,
} from '../utils/semantic-episodes';
import { createVoyageEmbedder } from '../utils/voyage-embedder';

describe('episodeDocument (KB-35)', () => {
  it('is the title, the plot and the key events the prompt shows', () => {
    expect(
      episodeDocument({
        title: ' The Keeper Leaves ',
        summary: 'The lighthouse keeper sails away.',
        keyEvents: ['the lamp goes dark', 'a letter is left'],
      }),
    ).toBe(
      'The Keeper Leaves\nThe lighthouse keeper sails away.\nKey events: the lamp goes dark; a letter is left',
    );
  });

  it('is capped', () => {
    expect(
      episodeDocument({ title: 't', summary: 'x'.repeat(10_000) }),
    ).toHaveLength(MAX_DOCUMENT_CHARS);
  });
});

describe('contentHash and episodesNeedingEmbedding (KB-35)', () => {
  const candidates = [
    { episodeId: 'e1', document: 'one' },
    { episodeId: 'e2', document: 'two' },
    { episodeId: 'e3', document: 'three' },
  ];

  it('changes with the text and with the model', () => {
    const base = contentHash('voyage-3-large', 'one');

    expect(contentHash('voyage-3-large', 'one')).toBe(base);
    expect(contentHash('voyage-3-large', 'one!')).not.toBe(base);
    expect(contentHash('voyage-large-2', 'one')).not.toBe(base);
  });

  it('selects every episode on first use', () => {
    expect(
      episodesNeedingEmbedding(candidates, new Map(), 'voyage-3-large').map(
        (c) => c.episodeId,
      ),
    ).toEqual(['e1', 'e2', 'e3']);
  });

  it('selects only missing or changed episodes afterwards', () => {
    const stored = new Map([
      ['e1', contentHash('voyage-3-large', 'one')],
      ['e2', contentHash('voyage-3-large', 'two, before an edit')],
    ]);

    const needed = episodesNeedingEmbedding(candidates, stored, 'voyage-3-large');

    expect(needed.map((c) => c.episodeId)).toEqual(['e2', 'e3']);
    expect(needed[0]!.hash).toBe(contentHash('voyage-3-large', 'two'));
  });

  it('selects everything again when the model changes', () => {
    const stored = new Map(
      candidates.map((c) => [c.episodeId, contentHash('voyage-3-large', c.document)]),
    );

    expect(episodesNeedingEmbedding(candidates, stored, 'voyage-3-large')).toEqual(
      [],
    );
    expect(
      episodesNeedingEmbedding(candidates, stored, 'voyage-large-2'),
    ).toHaveLength(3);
  });
});

describe('fallback and logging (KB-35)', () => {
  beforeEach(() => {
    resetSemanticLogLatch();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it('logs a missing key once per cold start', () => {
    const embedder = createVoyageEmbedder({ apiKey: undefined });

    expect(embedderOrLog(embedder)).toBeNull();
    expect(embedderOrLog(embedder)).toBeNull();
    expect(console.info).toHaveBeenCalledTimes(1);
    expect(console.info).toHaveBeenCalledWith(
      '[semantic-context] VOYAGE_API_KEY not set — sequential only',
    );
  });

  it('does not log when a key is set', () => {
    const embedder = createVoyageEmbedder({ apiKey: 'test-key-not-real' });

    expect(embedderOrLog(embedder)).toBe(embedder);
    expect(console.info).not.toHaveBeenCalled();
  });

  it('returns the fallback and logs one line when a step fails', async () => {
    const result = await withSequentialFallback(
      'query embedding',
      async () => {
        throw new Error('HTTP 503');
      },
      [] as string[],
    );

    expect(result).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(
      '[semantic-context] query embedding failed (Error: HTTP 503) — sequential only',
    );
  });

  it('returns the step result when it succeeds', async () => {
    expect(
      await withSequentialFallback('search', async () => ['e12'], []),
    ).toEqual(['e12']);
    expect(console.warn).not.toHaveBeenCalled();
  });
});
