import { describe, expect, it } from 'vitest';

import { MEASURE_INPUT_SUPPORT } from '@kit/clickhouse';

import {
  REFERENCE,
  doc,
  documentedNames,
} from './helpers/capability-reference';

/**
 * FILM-1713. Whether a platform reports a rate's input is a vendor fact, so
 * every cell of MEASURE_INPUT_SUPPORT traces to
 * `docs/platform-capability-reference.md`: a reported field is in the block
 * it names, an unreported one is in none of the blocks it names, and a
 * surface exception is stated on the field's own line. Deleting the line a
 * cell rests on must fail the cell.
 */

const DOCUMENTED = documentedNames();

const cells = Object.entries(MEASURE_INPUT_SUPPORT).flatMap(
  ([platform, inputs]) =>
    Object.entries(inputs).map(
      ([input, cell]) => [`${platform}.${input}`, cell!] as const,
    ),
);

describe('measure input support traces to the capability reference', () => {
  it('has cells to check', () => {
    expect(cells.length).toBeGreaterThanOrEqual(6);
  });

  it.each(cells)('%s', (name, cell) => {
    if (cell.support === 'not_reported') {
      for (const block of cell.absentFrom) {
        const names = DOCUMENTED.get(block);
        expect(
          names,
          `${name}: no ${block} block in ${REFERENCE}`,
        ).toBeDefined();
        for (const candidate of cell.candidates) {
          expect(
            names!.has(candidate),
            `${name}: '${candidate}' is documented in ${block}, so it is reported`,
          ).toBe(false);
        }
      }
      return;
    }

    expect(
      DOCUMENTED.get(cell.block)?.has(cell.field),
      `${name}: '${cell.field}' is not in the ${cell.block} block of ${REFERENCE}`,
    ).toBe(true);

    if (cell.support === 'reported_except_on') {
      const line = doc
        .split('\n')
        .find((text) => text.trim().startsWith(`${cell.field} `));
      for (const surface of cell.mediaSurfaces) {
        expect(
          line,
          `${name}: the ${cell.field} line does not say NOT ${surface}`,
        ).toContain(`NOT ${surface}`);
      }
    }
  });
});
