import { describe, expect, it } from 'vitest';

import { isUnavailable } from '../src/lib/query-state';

describe('isUnavailable', () => {
  it('is true when a query errored with nothing cached', () => {
    expect(isUnavailable({ isError: true, data: undefined })).toBe(true);
  });

  // The case it exists for: query-core keeps `data` and still reports an
  // error, so a failed refetch must not blank a rendered surface.
  it('is false when a failed refetch still holds data', () => {
    expect(isUnavailable({ isError: true, data: [{ id: 'a' }] })).toBe(false);
    expect(isUnavailable({ isError: true, data: [] })).toBe(false);
    expect(isUnavailable({ isError: true, data: null })).toBe(false);
  });

  it('is false while loading and after a success', () => {
    expect(isUnavailable({ isError: false, data: undefined })).toBe(false);
    expect(isUnavailable({ isError: false, data: [] })).toBe(false);
  });
});
