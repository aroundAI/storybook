import { describe, expect, it } from 'vitest';

import {
  ANALYTICS_PLATFORMS,
  CAPABILITY_MATRIX,
  METRIC_FAMILIES,
} from '@kit/clickhouse';

import {
  REFERENCE,
  doc,
  documentedNames,
} from './helpers/capability-reference';

/**
 * FILM-1703. Every entry of the capability matrix traces to
 * `docs/platform-capability-reference.md`, and a vendor name the reference
 * does not carry cannot be added to it.
 *
 * It lives here, beside the FILM-1721 guard, so the two read the reference
 * through one parser. The matrix's structural and writer-binding tests are in
 * `packages/clickhouse/__tests__/data-provenance.test.ts`.
 */
const DOCUMENTED = documentedNames();

const SECTIONS = new Set(
  [...doc.matchAll(/^## (.+)$/gm)].map(([, heading]) => heading!.trim()),
);

const ENTRIES = METRIC_FAMILIES.flatMap((family) =>
  ANALYTICS_PLATFORMS.map((platform) => ({
    id: `${family} × ${platform}`,
    capability: CAPABILITY_MATRIX[family][platform],
  })),
);

describe('the capability matrix is read from the reference', () => {
  it('finds the sections and entries it is checking', () => {
    // Guards the guard: a heading regex that matched nothing would let every
    // citation below fail for the wrong reason, or an empty matrix pass.
    expect(SECTIONS.has('YouTube')).toBe(true);
    expect(ENTRIES.length).toBe(
      METRIC_FAMILIES.length * ANALYTICS_PLATFORMS.length,
    );
  });

  it('cites a section of the reference for every entry', () => {
    const uncited = ENTRIES.filter(
      ({ capability }) => !SECTIONS.has(capability.reference.section),
    ).map(({ id, capability }) => `${id}: "${capability.reference.section}"`);

    expect(uncited, `No such "## " heading in ${REFERENCE}:`).toEqual([]);
  });

  it('names only vendor fields the reference documents, on the surface it cites', () => {
    const undocumented = ENTRIES.flatMap(({ id, capability }) => {
      const { surface, fields } = capability.reference;

      if (surface === null) return [];

      const names = DOCUMENTED.get(surface);

      if (!names) return [`${id}: no field block "${surface}"`];

      return fields
        .filter((field) => !names.has(field))
        .map((field) => `${id}: "${field}" is not in ${surface}`);
    });

    expect(
      undocumented,
      `Not in ${REFERENCE}. Add the name there first, with its source — ` +
        `our own provider types are not evidence of what a platform has:`,
    ).toEqual([]);
  });

  it('cites fields wherever it claims the platform can report something', () => {
    // `unsupported` is the only level that may cite nothing: there is no
    // field to name for a thing that does not exist. Every other level says
    // the platform has it, and has to say where.
    const bare = ENTRIES.filter(({ capability }) => {
      const { surface, fields } = capability.reference;

      return capability.level === 'unsupported'
        ? surface !== null || fields.length > 0
        : surface === null || fields.length === 0;
    }).map(({ id, capability }) => `${id} (${capability.level})`);

    expect(bare).toEqual([]);
  });
});
