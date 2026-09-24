import { describe, expect, it } from 'vitest';

import { mergeFailureMetadata } from '../failure-metadata';

/**
 * KB-66. `publishes.metadata` is jsonb. Typing the worker's client showed that
 * the failure path spread it without checking it was an object: an array or a
 * string spreads into index keys ("0", "1", …) that then sit beside the error.
 */

const failure = {
  error: 'Upload rejected',
  errorStack: 'Error: Upload rejected',
  failedAt: '2026-09-24T08:00:00.000Z',
};

describe('mergeFailureMetadata', () => {
  it('keeps the existing object metadata and adds the failure', () => {
    expect(mergeFailureMetadata({ tags: ['a'], retries: 1 }, failure)).toEqual(
      { tags: ['a'], retries: 1, ...failure },
    );
  });

  it('starts from an empty object when there is no metadata', () => {
    expect(mergeFailureMetadata(null, failure)).toEqual(failure);
    expect(mergeFailureMetadata(undefined, failure)).toEqual(failure);
  });

  it('does not spread non-object metadata into index keys', () => {
    expect(mergeFailureMetadata(['x', 'y'], failure)).toEqual(failure);
    expect(mergeFailureMetadata('abc', failure)).toEqual(failure);
    expect(mergeFailureMetadata(42, failure)).toEqual(failure);
  });
});
