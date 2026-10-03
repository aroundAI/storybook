import { describe, expect, it, vi } from 'vitest';

import {
  VOYAGE_EMBEDDING_DIMENSIONS,
  VoyageEmbeddingError,
  createVoyageEmbedder,
} from '../src/embedding/voyage-embedder';

// KB-35: every request here goes to a fake fetch. No test reaches Voyage and
// no real key exists in this file.
const KEY = 'test-key-not-real';

function vector(seed: number) {
  return Array.from({ length: VOYAGE_EMBEDDING_DIMENSIONS }, (_, i) =>
    i === 0 ? seed : 0,
  );
}

function respondWith(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

function voyageBody(vectors: number[][], shuffle = false) {
  const data = vectors.map((embedding, index) => ({
    object: 'embedding',
    embedding,
    index,
  }));
  return { object: 'list', data: shuffle ? data.reverse() : data };
}

describe('createVoyageEmbedder (KB-35)', () => {
  it.each([undefined, '', '   '])(
    'returns no embedder, and makes no request, without a key (%j)',
    (apiKey) => {
      const fetchImpl = vi.fn();

      expect(createVoyageEmbedder({ apiKey, fetchImpl })).toBeNull();
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it('posts documents in one batch with the model, input type and dimension', async () => {
    const fetchImpl = respondWith(voyageBody([vector(1), vector(2)]));
    const embedder = createVoyageEmbedder({
      apiKey: KEY,
      fetchImpl,
      baseUrl: 'http://voyage.test',
    })!;

    const vectors = await embedder.embedDocuments(['one', 'two']);

    expect(vectors.map((v) => v[0])).toEqual([1, 2]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]! as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('http://voyage.test/v1/embeddings');
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${KEY}` });
    expect(JSON.parse(init.body as string)).toEqual({
      input: ['one', 'two'],
      model: 'voyage-3-large',
      input_type: 'document',
      output_dimension: VOYAGE_EMBEDDING_DIMENSIONS,
    });
  });

  it('embeds a query with input_type query', async () => {
    const fetchImpl = respondWith(voyageBody([vector(7)]));
    const embedder = createVoyageEmbedder({ apiKey: KEY, fetchImpl })!;

    expect((await embedder.embedQuery('a lighthouse'))[0]).toBe(7);
    const init = (
      fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    )[1];
    expect(JSON.parse(init.body as string).input_type).toBe('query');
  });

  it('returns vectors in input order when the response is not', async () => {
    const fetchImpl = respondWith(voyageBody([vector(1), vector(2)], true));
    const embedder = createVoyageEmbedder({ apiKey: KEY, fetchImpl })!;

    expect(
      (await embedder.embedDocuments(['a', 'b'])).map((v) => v[0]),
    ).toEqual([1, 2]);
  });

  it('makes no request for an empty batch', async () => {
    const fetchImpl = vi.fn();
    const embedder = createVoyageEmbedder({ apiKey: KEY, fetchImpl })!;

    expect(await embedder.embedDocuments([])).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['an HTTP error', respondWith({ detail: 'rate limited' }, 429), 'HTTP 429'],
    [
      'a body without data',
      respondWith({ embeddings: [vector(1)] }),
      'no data array',
    ],
    [
      'a vector of the wrong length',
      respondWith(voyageBody([[0.1, 0.2]])),
      'is not 1024 finite numbers',
    ],
    [
      'a non-JSON body',
      vi.fn(async () => new Response('<html>')),
      'no data array',
    ],
    [
      'too few vectors',
      respondWith(voyageBody([vector(1)])),
      'expected 2 embeddings, got 1',
    ],
  ])(
    'rejects %s, never returning a bad vector',
    async (_, fetchImpl, message) => {
      const embedder = createVoyageEmbedder({ apiKey: KEY, fetchImpl })!;

      const error = await embedder.embedDocuments(['a', 'b']).catch((e) => e);
      expect(error).toBeInstanceOf(VoyageEmbeddingError);
      expect(error.message).toContain(message);
    },
  );

  it('turns a network failure or timeout into an error that does not carry the key', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException(`aborted ${KEY}`, 'TimeoutError');
    });
    const embedder = createVoyageEmbedder({ apiKey: KEY, fetchImpl })!;

    const error = await embedder.embedQuery('x').catch((e) => e);
    expect(error).toBeInstanceOf(VoyageEmbeddingError);
    expect(error.message).toBe('request failed: TimeoutError');
    expect(error.message).not.toContain(KEY);
  });

  it('passes a timeout signal to fetch', async () => {
    const fetchImpl = respondWith(voyageBody([vector(1)]));
    const embedder = createVoyageEmbedder({
      apiKey: KEY,
      fetchImpl,
      timeoutMs: 50,
    })!;

    await embedder.embedQuery('x');
    const init = (
      fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    )[1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
