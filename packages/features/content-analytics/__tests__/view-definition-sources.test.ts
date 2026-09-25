import { describe, expect, it } from 'vitest';

import { VIEW_DEFINITIONS } from '@kit/clickhouse';

import {
  REFERENCE,
  doc,
  documentedNames,
} from './helpers/capability-reference';
import { forbiddenNames } from './helpers/forbidden-names';

/**
 * FILM-1722. Every view definition traces to
 * `docs/platform-capability-reference.md` — a field to the block that
 * documents it, an entry to the section that describes it, a date to a
 * sentence that states it.
 *
 * The registry lives in `@kit/clickhouse` and this test lives here because
 * the parser for that document does. Nothing below restates the document:
 * deleting the line a definition rests on must fail the definition.
 */

const DOCUMENTED = documentedNames();
const FORBIDDEN = forbiddenNames();

/** GitHub's heading slug: lower-cased, punctuation dropped, spaces to hyphens. */
function slug(heading: string) {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/g, '')
    .replace(/ /g, '-');
}

const ANCHORS = new Set(
  [...doc.matchAll(/^#{2,4} (.+)$/gm)].map(([, heading]) => slug(heading!)),
);

function section(anchor: string) {
  const headings = [...doc.matchAll(/^(#{2,4}) (.+)$/gm)];
  const index = headings.findIndex(([, , text]) => slug(text!) === anchor);
  const heading = headings[index]!;
  const depth = heading[1]!.length;
  const next = headings
    .slice(index + 1)
    .find(([, hashes]) => hashes!.length <= depth);

  return doc.slice(heading.index, next?.index);
}

describe('view definitions trace to the capability reference', () => {
  it('finds headings to bind to', () => {
    expect(ANCHORS.size).toBeGreaterThan(15);
    expect(ANCHORS.has('the-four-denominators')).toBe(true);
  });

  it.each(VIEW_DEFINITIONS.map((entry) => [entry.id, entry] as const))(
    '%s points at a section that exists',
    (_, entry) => {
      expect(
        ANCHORS.has(entry.reference.slice(1)),
        `${entry.reference} is not a heading in ${REFERENCE}`,
      ).toBe(true);
    },
  );

  it('names only fields the reference documents, on the surface it says', () => {
    const replacedIds = new Set(
      VIEW_DEFINITIONS.flatMap((entry) => entry.supersedes ?? []),
    );

    const undocumented = VIEW_DEFINITIONS.flatMap((entry) => {
      if (entry.availability === 'ads_only') return [];

      // A field its successor renamed is, correctly, no longer in the index.
      const successor = VIEW_DEFINITIONS.find(
        (candidate) => candidate.supersedes === entry.id,
      );

      if (
        replacedIds.has(entry.id) &&
        successor &&
        successor.field !== entry.field
      ) {
        return [];
      }

      return DOCUMENTED.get(entry.surface)?.has(entry.field)
        ? []
        : [
            `${entry.id}: '${entry.field}' is not in the ${entry.surface} block`,
          ];
    });

    expect(undocumented, `In ${REFERENCE}:`).toEqual([]);
  });

  it('lists every renamed field as retired, pointing at its successor', () => {
    const renames = VIEW_DEFINITIONS.flatMap((entry) => {
      const replaced = VIEW_DEFINITIONS.find(
        (candidate) => candidate.id === entry.supersedes,
      );

      return replaced && replaced.field !== entry.field
        ? [{ from: replaced.field, to: entry.field, id: entry.id }]
        : [];
    });

    expect(renames.map((rename) => rename.id)).toEqual(['instagram.views']);

    for (const rename of renames) {
      expect(
        FORBIDDEN.some(
          (entry) =>
            entry.name === rename.from && entry.replacement === rename.to,
        ),
        `${rename.from} -> ${rename.to} is not in the forbidden block`,
      ).toBe(true);
    }
  });

  it('states every date in the section it cites', () => {
    const unstated = VIEW_DEFINITIONS.flatMap((entry) =>
      [entry.effectiveFrom, entry.rolloutCompleteBy]
        .filter((date): date is string => typeof date === 'string')
        .filter((date) => !section(entry.reference.slice(1)).includes(date))
        .map(
          (date) =>
            `${entry.id}: ${date} is not stated under ${entry.reference}`,
        ),
    );

    expect(unstated, `In ${REFERENCE}:`).toEqual([]);
  });

  it('marks a definition estimated only where its section says so', () => {
    const unsupported = VIEW_DEFINITIONS.filter(
      (entry) =>
        entry.isEstimated === true &&
        !/estimated/i.test(section(entry.reference.slice(1))),
    ).map((entry) => entry.id);

    expect(unsupported, `In ${REFERENCE}:`).toEqual([]);
  });

  it('keeps ThruPlay out of the field index entirely', () => {
    const everyName = [...DOCUMENTED.values()].flatMap((names) => [...names]);

    expect(everyName.filter((name) => /thru_?play/i.test(name))).toEqual([]);
  });
});

describe('view-definition aliases trace to the capability reference (FILM-1722)', () => {
  const withAliases = VIEW_DEFINITIONS.flatMap((entry) =>
    entry.availability === 'organic'
      ? (entry.aliases ?? []).map(
          (alias) => [entry.id, entry.field, alias] as const,
        )
      : [],
  );

  it('has at least the Instagram Media-node spelling', () => {
    expect(withAliases).toContainEqual([
      'instagram.total_views',
      'total_views',
      'total_views_count',
    ]);
  });

  it.each(withAliases)(
    '%s: %s and its alias %s are named as one number on one line',
    (_, field, alias) => {
      const everyName = [...DOCUMENTED.values()].flatMap((names) => [...names]);
      expect(everyName, `${alias} is in no field block`).toContain(alias);

      const statesBoth = doc
        .split('\n')
        .some(
          (line) =>
            line.includes(`\`${alias}\``) && line.includes(`\`${field}\``),
        );
      expect(
        statesBoth,
        `no line in ${REFERENCE} names ${alias} with ${field}`,
      ).toBe(true);
    },
  );
});
