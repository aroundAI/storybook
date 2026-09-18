import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import * as server from '../src/server';

/**
 * Every query and insert must run against a real ClickHouse (FILM-1610
 * review, D1).
 *
 * `scripts/verify-queries.ts` is what CI's "ClickHouse SQL" job runs, and it
 * is a hand-kept list. Three queries were missing from it — one new, two
 * from the subscriber work — so that job was green over SQL that had never
 * been parsed by a server. This makes a missing entry a failing test rather
 * than something a reviewer has to notice.
 */
const VERIFY_SOURCE = readFileSync(
  join(import.meta.dirname, '../scripts/verify-queries.ts'),
  'utf8',
);

describe('verify-queries covers every exported query and insert', () => {
  const exported = Object.entries(server)
    .filter(
      ([name, value]) =>
        typeof value === 'function' && /^(query|insert)[A-Z]/.test(name),
    )
    .map(([name]) => name)
    .sort();

  it('finds the exports it is checking', () => {
    // Guards the guard: an import that silently resolved to nothing would
    // make the next test pass over an empty list.
    expect(exported.length).toBeGreaterThan(20);
  });

  it('has a step calling each one', () => {
    const missing = exported.filter(
      (name) => !new RegExp(`\\b${name}\\(`).test(VERIFY_SOURCE),
    );

    expect(missing).toEqual([]);
  });
});
