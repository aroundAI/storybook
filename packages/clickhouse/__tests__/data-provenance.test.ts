import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ANALYTICS_PLATFORMS,
  AUDIENCE_FAMILY_DIMENSIONS,
  CAPABILITY_MATRIX,
  INGESTION_MARKERS,
  METRIC_FAMILIES,
  TABLE_WRITERS,
  WRITER_CALL_SITES,
  accessFor,
  allowedMetricSources,
  capabilityFor,
  coverageSummary,
  platformsWithData,
  unclaimedPlatforms,
} from '../src/lib/data-provenance';
import type {
  PlatformCapability,
  SourceTable,
} from '../src/lib/data-provenance';

/**
 * FILM-1703. A capability matrix that drifts from the pipeline is worse than
 * none, because it is believed — so the suite is the deliverable, in three
 * layers: (a) structural, (b) writer binding, and (c) the live cross-check in
 * `scripts/verify-queries.ts`, whose pure half is tested here.
 *
 * That every entry cites `docs/platform-capability-reference.md` is asserted
 * in `@kit/content-analytics`, beside the FILM-1721 guard whose parser it
 * shares: `__tests__/capability-matrix-reference.test.ts`.
 */
const REPO = resolve(import.meta.dirname, '../../..');
const MODULE = 'packages/clickhouse/src/lib/data-provenance.ts';

function read(file: string) {
  return readFileSync(join(REPO, file), 'utf8');
}

const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.turbo',
  '.git',
  'dist',
  'coverage',
  // Mocked clients: a call here writes to nothing.
  '__tests__',
]);

function sourceFiles(dir: string, extensions: string[]): string[] {
  if (!existsSync(dir)) return [];

  return readdirSync(dir).flatMap((name) => {
    if (SKIP_DIRS.has(name)) return [];

    const path = join(dir, name);

    if (statSync(path).isDirectory()) return sourceFiles(path, extensions);

    return extensions.some((extension) => name.endsWith(extension)) &&
      !/\.test\.[cm]?[jt]sx?$/.test(name)
      ? [path]
      : [];
  });
}

function repoPath(file: string) {
  return relative(REPO, file).split(sep).join('/');
}

const CODE = ['apps', 'packages', 'scripts', 'tooling'].flatMap((root) =>
  sourceFiles(join(REPO, root), ['.ts', '.tsx', '.mts', '.js', '.mjs']),
);

function filesContaining(pattern: RegExp, files = CODE) {
  return files
    .filter((file) => pattern.test(readFileSync(file, 'utf8')))
    .map(repoPath)
    .sort();
}

/**
 * An entry as a test sees it: every field optional and unknown. The exported
 * type already rules most of what follows out at compile time; these run
 * anyway, because a cast gets past a type and vitest does not typecheck.
 */
interface LooseEntry {
  level?: unknown;
  table?: unknown;
  method?: unknown;
  blockedBy?: unknown;
  access?: unknown;
  accessSince?: unknown;
  availability?: unknown;
  unknownOwner?: unknown;
  unknownQuestion?: unknown;
  note?: unknown;
  window?: { maxAgeDays?: unknown; anchoredOn?: unknown };
  accountGate?: { requirement?: unknown; note?: unknown };
}

// Widened to string keys, so a family or platform the matrix lacks reads as
// `undefined` here instead of being ruled out by a type the test cannot trust.
const MATRIX: Record<
  string,
  Record<string, LooseEntry | undefined> | undefined
> = CAPABILITY_MATRIX;

const ENTRIES = METRIC_FAMILIES.flatMap((family) =>
  ANALYTICS_PLATFORMS.map((platform) => ({
    id: `${family} × ${platform}`,
    family,
    platform,
    entry: MATRIX[family]?.[platform],
  })),
);

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const hasData = ({ level }: LooseEntry) =>
  level === 'native' || level === 'derived';

const isOneOf =
  (...allowed: string[]) =>
  (value: unknown) =>
    allowed.includes(value as string);

// Identifiers, ticket ids, table and level names. A note is rendered verbatim
// to someone asking why a number is missing.
const DEVELOPER_VOCABULARY =
  /[`_]|FILM-|ClickHouse|\b(native|derived|ingest\w*|unsupported|scope|OAuth|endpoint)\b/i;

const SPECS = sourceFiles(join(REPO, 'specs'), ['.md', '.yaml']).map(repoPath);

/** A well-formed entry of each level, to break one rule at a time. */
const AXES = {
  access: 'authorised',
  availability: 'included',
  window: { maxAgeDays: null, anchoredOn: 'request_date' },
  note: 'The platform reports this for each day.',
};
const NATIVE: LooseEntry = { ...AXES, level: 'native', table: 'video_metrics' };
const DERIVED: LooseEntry = {
  ...NATIVE,
  level: 'derived',
  method: 'account_level',
};
const NOT_INGESTED: LooseEntry = {
  ...AXES,
  level: 'not_ingested',
  table: null,
  blockedBy: 'FILM-1712',
};
const UNSUPPORTED: LooseEntry = {
  ...AXES,
  level: 'unsupported',
  table: null,
  blockedBy: null,
};

/**
 * Every structural rule, with an entry that breaks it.
 *
 * The counter-example is not decoration. Several rules have no instance in
 * today's matrix — nothing is `review_pending`, nothing is `unknown` — so run
 * against the matrix alone they would pass whether or not they worked. Each
 * is therefore also run against the entry it exists to reject.
 */
const RULES: Array<{
  rule: string;
  applies?: (entry: LooseEntry) => boolean;
  holds: (entry: LooseEntry) => boolean;
  broken: LooseEntry;
}> = [
  {
    rule: 'has a level, and only one of the four',
    holds: ({ level }) =>
      isOneOf('native', 'derived', 'not_ingested', 'unsupported')(level),
    broken: { ...NATIVE, level: 'fabricated' },
  },
  {
    // `account_type_gated` is the creator's and never static — see accessFor.
    rule: 'has an access state that is ours to resolve',
    holds: ({ access }) =>
      isOneOf(
        'authorised',
        'scope_missing',
        'review_required',
        'review_pending',
        'review_denied',
      )(access),
    broken: { ...NATIVE, access: 'account_type_gated' },
  },
  {
    rule: 'has an availability',
    holds: ({ availability }) =>
      isOneOf('included', 'metered', 'tier_gated', 'unknown')(availability),
    broken: { ...NATIVE, availability: undefined },
  },
  {
    rule: 'has a window that says what it is anchored on',
    holds: ({ window }) =>
      isOneOf(
        'publish_date',
        'job_creation',
        'request_date',
      )(window?.anchoredOn),
    broken: { ...NATIVE, window: { maxAgeDays: 30 } },
  },
  {
    rule: 'has a window that is unbounded or a positive number of days',
    holds: ({ window }) =>
      window?.maxAgeDays === null ||
      (typeof window?.maxAgeDays === 'number' && window.maxAgeDays > 0),
    broken: { ...NATIVE, window: { anchoredOn: 'publish_date' } },
  },
  {
    rule: 'derived names its method',
    applies: ({ level }) => level === 'derived',
    holds: ({ method }) => isText(method),
    broken: { ...DERIVED, method: undefined },
  },
  {
    rule: 'only derived has a method',
    applies: ({ level }) => level !== 'derived',
    holds: ({ method }) => method === undefined,
    broken: { ...NATIVE, method: 'account_level' },
  },
  {
    rule: 'native and derived name the table the data is in',
    applies: hasData,
    holds: ({ table }) => Object.hasOwn(TABLE_WRITERS, table as string),
    broken: { ...NATIVE, table: null },
  },
  {
    rule: 'not_ingested and unsupported name no table',
    applies: (entry) => !hasData(entry),
    holds: ({ table }) => table === null,
    broken: { ...UNSUPPORTED, table: 'video_metrics' },
  },
  {
    rule: 'unsupported is blocked by nothing, because there is nothing to build',
    applies: ({ level }) => level === 'unsupported',
    holds: ({ blockedBy }) => blockedBy === null,
    broken: { ...UNSUPPORTED, blockedBy: 'FILM-1712' },
  },
  {
    rule: 'not_ingested names the spec that blocks it, and the spec exists',
    applies: ({ level }) => level === 'not_ingested',
    holds: ({ blockedBy }) =>
      typeof blockedBy === 'string' &&
      /^FILM-\d+$/.test(blockedBy) &&
      SPECS.some((spec) => spec.includes(`/${blockedBy}-`)),
    broken: { ...NOT_INGESTED, blockedBy: 'FILM-99999' },
  },
  {
    rule: 'not_ingested is never blocked by nothing',
    applies: ({ level }) => level === 'not_ingested',
    holds: ({ blockedBy }) => blockedBy !== null && blockedBy !== undefined,
    broken: { ...NOT_INGESTED, blockedBy: null },
  },
  {
    rule: 'only a level with nothing to show is blocked by anything',
    applies: hasData,
    holds: ({ blockedBy }) => blockedBy === undefined,
    broken: { ...NATIVE, blockedBy: 'FILM-1712' },
  },
  {
    rule: 'does not ask a creator to change account type for something that does not exist',
    applies: ({ level }) => level === 'unsupported',
    holds: ({ accountGate }) => accountGate === undefined,
    broken: {
      ...UNSUPPORTED,
      accountGate: { requirement: 'a Business account', note: 'Switch.' },
    },
  },
  {
    rule: 'a pending or denied review carries its date',
    applies: ({ access }) => isOneOf('review_pending', 'review_denied')(access),
    holds: ({ accessSince }) =>
      isText(accessSince) && /^\d{4}-\d{2}-\d{2}$/.test(accessSince),
    broken: { ...NATIVE, access: 'review_pending' },
  },
  {
    rule: 'unknown availability names its owner and its question',
    applies: ({ availability }) => availability === 'unknown',
    holds: ({ unknownOwner, unknownQuestion }) =>
      isText(unknownOwner) && isText(unknownQuestion),
    broken: { ...NATIVE, availability: 'unknown', unknownOwner: 'FILM-1727' },
  },
  {
    rule: 'an account gate says what is needed, and what to tell a creator without it',
    applies: ({ accountGate }) => accountGate !== undefined,
    holds: ({ accountGate }) =>
      isText(accountGate?.requirement) && isText(accountGate?.note),
    broken: {
      ...NOT_INGESTED,
      accountGate: { requirement: 'a Business account' },
    },
  },
  {
    rule: 'has a note',
    holds: ({ note }) => isText(note),
    broken: { ...UNSUPPORTED, note: ' ' },
  },
  {
    rule: 'the note is one sentence',
    holds: ({ note }) =>
      isText(note) && note.endsWith('.') && !/[.!?]\s+\S/.test(note),
    broken: { ...UNSUPPORTED, note: 'Not reported. See the docs.' },
  },
  {
    rule: 'the note is written for a creator, not for a developer',
    holds: ({ note }) => isText(note) && !DEVELOPER_VOCABULARY.test(note),
    broken: { ...NOT_INGESTED, note: 'Not ingested: blocked by FILM-1712.' },
  },
];

// ---------------------------------------------------------------------------
// (a) Structural
// ---------------------------------------------------------------------------

describe('the matrix covers every platform', () => {
  it('lists exactly the members of AnalyticsPlatform', () => {
    // Read from the source, because the union is a type and a test cannot
    // see one. Adding `| 'facebook'` to it fails here until the list — and
    // then the matrix — is extended.
    const union = /export type AnalyticsPlatform =([^;]+);/.exec(
      read('packages/clickhouse/src/types.ts'),
    )?.[1];

    expect(union, 'AnalyticsPlatform not found in types.ts').toBeDefined();

    const members = [...union!.matchAll(/'([^']+)'/g)].map(([, name]) => name);

    expect(members.length).toBeGreaterThan(0);
    expect([...ANALYTICS_PLATFORMS].sort()).toEqual(members.sort());
  });

  it('has an entry for every family on every platform, and no others', () => {
    expect(ENTRIES.filter(({ entry }) => !entry).map(({ id }) => id)).toEqual(
      [],
    );

    expect(Object.keys(CAPABILITY_MATRIX).sort()).toEqual(
      [...METRIC_FAMILIES].sort(),
    );

    for (const family of METRIC_FAMILIES) {
      expect(Object.keys(CAPABILITY_MATRIX[family]).sort(), family).toEqual(
        [...ANALYTICS_PLATFORMS].sort(),
      );
    }
  });
});

describe.each(RULES.map((rule) => [rule.rule, rule] as const))(
  'every entry: %s',
  (_, { applies, holds, broken }) => {
    const inScope = applies ?? (() => true);

    it('holds across the matrix', () => {
      const offenders = ENTRIES.filter(
        ({ entry }) => entry !== undefined && inScope(entry) && !holds(entry),
      ).map(({ id }) => id);

      expect(offenders).toEqual([]);
    });

    it('rejects an entry that breaks it', () => {
      expect(inScope(broken)).toBe(true);
      expect(holds(broken)).toBe(false);
    });
  },
);

// ---------------------------------------------------------------------------
// The claims the spec makes by name
// ---------------------------------------------------------------------------

describe('what the platform cannot do is kept apart from what we have not done', () => {
  it('Instagram watch time is ours to build, never unsupported', () => {
    // Instagram documents both Reels watch-time fields; we never request them.
    expect(capabilityFor('watch_time', 'instagram')).toMatchObject({
      level: 'not_ingested',
      blockedBy: 'FILM-1712',
      table: null,
    });
  });

  it('TikTok and Instagram watch time share a level and not a price', () => {
    const tiktok = capabilityFor('watch_time', 'tiktok');
    const instagram = capabilityFor('watch_time', 'instagram');

    expect(tiktok.level).toBe(instagram.level);
    expect(tiktok.accountGate).toBeDefined();
    expect(instagram.accountGate).toBeUndefined();
  });

  it('traffic sources: TikTok is our gap, Instagram has nothing to fetch', () => {
    expect(capabilityFor('traffic_sources', 'youtube').level).toBe('native');
    expect(capabilityFor('traffic_sources', 'tiktok').level).toBe(
      'not_ingested',
    );
    expect(capabilityFor('traffic_sources', 'instagram').level).toBe(
      'unsupported',
    );
  });

  it('YouTube revenue is authorised (FILM-1711) but still not ingested', () => {
    // The scope moved from missing to authorised in code; ClickHouse
    // ingestion is a separate axis and stays not_ingested until something
    // replaces the literal 0 every sync path writes to revenue_cents.
    expect(capabilityFor('revenue', 'youtube')).toMatchObject({
      level: 'not_ingested',
      access: 'authorised',
      blockedBy: 'FILM-1711',
    });
  });

  it('daily engagement is true-daily on YouTube and a fetch-day delta elsewhere', () => {
    expect(capabilityFor('engagement', 'youtube').level).toBe('native');

    for (const platform of ['tiktok', 'instagram'] as const) {
      expect(capabilityFor('engagement', platform)).toMatchObject({
        level: 'derived',
        method: 'snapshot_delta_fetch_day',
      });
    }
  });

  it('a job-creation window is not confused with a publish-anchored one', () => {
    expect(capabilityFor('reach', 'youtube').window).toEqual({
      maxAgeDays: 30,
      anchoredOn: 'job_creation',
    });
    expect(capabilityFor('watch_time', 'tiktok').window.anchoredOn).toBe(
      'publish_date',
    );
  });
});

describe('the invariants are in the type, not only in this suite', () => {
  // Checked by `tsc`, which runs over __tests__: each `@ts-expect-error` is
  // itself an error if the line below it compiles. So an edit that loosens
  // PlatformCapability until a malformed entry is accepted fails typecheck.
  const axes = {
    access: 'authorised',
    availability: 'included',
    window: { maxAgeDays: null, anchoredOn: 'request_date' },
    note: 'The platform reports this for each day.',
    reference: { section: 'YouTube', surface: null, fields: [] },
  } as const;
  const measured = {
    ...axes,
    level: 'native',
    table: 'video_metrics',
  } as const;
  const absent = { ...axes, table: null } as const;

  const entries: PlatformCapability[] = [
    measured,
    { ...measured, level: 'derived', method: 'account_level' },
    { ...absent, level: 'not_ingested', blockedBy: 'FILM-1712' },
    { ...absent, level: 'unsupported', blockedBy: null },
    // @ts-expect-error derived must name its method
    { ...measured, level: 'derived' },
    // @ts-expect-error only derived has a method
    { ...measured, method: 'account_level' },
    // @ts-expect-error native must name its table
    { ...absent, level: 'native' },
    // @ts-expect-error not_ingested must name what blocks it
    { ...absent, level: 'not_ingested' },
    // @ts-expect-error unsupported is blocked by nothing
    { ...absent, level: 'unsupported', blockedBy: 'FILM-1712' },
    // @ts-expect-error there is no fifth level
    { ...absent, level: 'fabricated', blockedBy: null },
    // @ts-expect-error a pending review carries its date
    { ...measured, access: 'review_pending' },
    // @ts-expect-error account_type_gated is the creator's, never static
    { ...measured, access: 'account_type_gated' },
    // @ts-expect-error unknown availability names its owner and question
    { ...measured, availability: 'unknown' },
    // @ts-expect-error a window says what it is anchored on
    { ...measured, window: { maxAgeDays: 30 } },
  ];

  it('accepts one well-formed entry of each level', () => {
    expect(entries.slice(0, 4).map(({ level }) => level)).toEqual([
      'native',
      'derived',
      'not_ingested',
      'unsupported',
    ]);
  });
});

describe('accessFor', () => {
  it('a YPP creator is authorised; a non-YPP creator meets the gate', () => {
    // FILM-1711 requested the scope, so a YPP creator's own access is no
    // longer blocked on us — only on being in the Partner Program at all.
    expect(accessFor('revenue', 'youtube', { meetsAccountGate: true })).toBe(
      'authorised',
    );
    expect(accessFor('revenue', 'youtube', { meetsAccountGate: false })).toBe(
      'account_type_gated',
    );
  });

  it('a personal TikTok account is gated; a Business one waits on us', () => {
    expect(accessFor('watch_time', 'tiktok', { meetsAccountGate: false })).toBe(
      'account_type_gated',
    );
    expect(accessFor('watch_time', 'tiktok', { meetsAccountGate: true })).toBe(
      'review_required',
    );
  });

  it('gates nobody where the platform asks nothing of the account', () => {
    expect(
      accessFor('engagement', 'instagram', { meetsAccountGate: false }),
    ).toBe('review_required');
  });

  it('keeps the three unresolved states apart, because each has its own owner', () => {
    // `scope_missing` had exactly one real occurrence — YouTube revenue —
    // and FILM-1711 requesting that scope closed it: no entry in the matrix
    // carries it any more (grep `access: 'scope_missing'` in
    // data-provenance.ts). The state stays in the type, because the same
    // situation — a gap we can close with a code change alone, no vendor
    // review — can recur for a future platform or family; this proves the
    // type still keeps it distinct from the other two, via a synthetic
    // capability rather than a live one.
    expect(
      Object.values(CAPABILITY_MATRIX).flatMap((byPlatform) =>
        Object.values(byPlatform),
      ),
    ).not.toContainEqual(expect.objectContaining({ access: 'scope_missing' }));

    const synthetic: PlatformCapability = {
      level: 'not_ingested',
      table: null,
      blockedBy: 'FILM-1712',
      access: 'scope_missing',
      availability: 'included',
      window: { maxAgeDays: null, anchoredOn: 'publish_date' },
      note: 'synthetic — see comment above',
      reference: { section: 'test', surface: null, fields: [] },
    };

    const states = new Set([
      synthetic.access,
      accessFor('watch_time', 'instagram', { meetsAccountGate: true }),
      accessFor('watch_time', 'tiktok', { meetsAccountGate: false }),
    ]);

    expect([...states].sort()).toEqual([
      'account_type_gated',
      'review_required',
      'scope_missing',
    ]);
  });
});

describe('platformsWithData', () => {
  it('counts native and derived, and nothing else', () => {
    expect(platformsWithData('engagement')).toEqual([
      'youtube',
      'tiktok',
      'instagram',
    ]);
    expect(platformsWithData('traffic_sources')).toEqual(['youtube']);
    expect(platformsWithData('revenue')).toEqual([]);
  });

  it('agrees with the matrix for every family', () => {
    for (const family of METRIC_FAMILIES) {
      expect(platformsWithData(family), family).toEqual(
        ANALYTICS_PLATFORMS.filter((platform) =>
          ['native', 'derived'].includes(capabilityFor(family, platform).level),
        ),
      );
    }
  });
});

describe('coverageSummary', () => {
  it('sorts the selected platforms by what their figures are', () => {
    expect(coverageSummary('watch_time')).toEqual({
      measured: ['youtube'],
      derived: [],
      absent: ['tiktok', 'instagram'],
      caveats: [
        {
          platform: 'tiktok',
          level: 'not_ingested',
          note: capabilityFor('watch_time', 'tiktok').note,
        },
        {
          platform: 'instagram',
          level: 'not_ingested',
          note: capabilityFor('watch_time', 'instagram').note,
        },
      ],
    });
  });

  it('lets a consumer tell unsupported from not_ingested', () => {
    const levels = coverageSummary('traffic_sources').caveats.map(
      ({ platform, level }) => [platform, level],
    );

    expect(levels).toEqual([
      ['tiktok', 'not_ingested'],
      ['instagram', 'unsupported'],
    ]);
  });

  it('reports only what was selected, in platform order', () => {
    const summary = coverageSummary('engagement', ['instagram', 'youtube']);

    expect(summary.measured).toEqual(['youtube']);
    expect(summary.derived).toEqual(['instagram']);
    expect(summary.caveats.map(({ platform }) => platform)).toEqual([
      'instagram',
    ]);
  });

  it('says nothing about a native platform', () => {
    expect(coverageSummary('engagement', ['youtube']).caveats).toEqual([]);
  });

  it('is empty for an empty selection', () => {
    expect(coverageSummary('engagement', [])).toEqual({
      measured: [],
      derived: [],
      absent: [],
      caveats: [],
    });
  });
});

describe('the audience families split video_audience between them', () => {
  it('assigns every AudienceDimension to exactly one family', () => {
    const union = /export type AudienceDimension =([^;]+);/.exec(
      read('packages/clickhouse/src/types.ts'),
    )?.[1];

    const dimensions = [...union!.matchAll(/'([^']+)'/g)].map(([, d]) => d);

    expect(dimensions.length).toBeGreaterThan(0);
    expect(Object.values(AUDIENCE_FAMILY_DIMENSIONS).flat().sort()).toEqual(
      dimensions.sort(),
    );
  });

  it('covers exactly the families the matrix reads from video_audience', () => {
    const audienceFamilies = METRIC_FAMILIES.filter((family) =>
      ANALYTICS_PLATFORMS.some(
        (platform) =>
          capabilityFor(family, platform).table === 'video_audience',
      ),
    );

    expect(Object.keys(AUDIENCE_FAMILY_DIMENSIONS).sort()).toEqual(
      [...audienceFamilies].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// (c) The pure half of the live cross-check
// ---------------------------------------------------------------------------

describe('unclaimedPlatforms', () => {
  it('accepts a subset, including an empty table', () => {
    expect(unclaimedPlatforms('traffic_sources', [])).toEqual([]);
    expect(unclaimedPlatforms('traffic_sources', ['youtube'])).toEqual([]);
    expect(unclaimedPlatforms('engagement', ['tiktok', 'youtube'])).toEqual([]);
  });

  it('reports a platform the pipeline produced and the matrix does not claim', () => {
    expect(
      unclaimedPlatforms('traffic_sources', ['youtube', 'tiktok', 'tiktok']),
    ).toEqual(['tiktok']);
  });

  it('reports a platform it has never heard of', () => {
    expect(unclaimedPlatforms('engagement', ['facebook'])).toEqual([
      'facebook',
    ]);
  });
});

describe('allowedMetricSources', () => {
  it('reconciles with the derivation video_metrics rows already record', () => {
    expect(
      allowedMetricSources(capabilityFor('engagement', 'youtube')),
    ).toEqual(['analytics_api', 'reporting_api', 'backfill']);

    // A `reporting_api` row for TikTok means the matrix is wrong.
    expect(allowedMetricSources(capabilityFor('engagement', 'tiktok'))).toEqual(
      ['snapshot_delta'],
    );
    expect(
      allowedMetricSources(capabilityFor('engagement', 'instagram')),
    ).toEqual(['snapshot_delta']);
  });

  it('allows no rows at all where there is nothing to show', () => {
    expect(
      allowedMetricSources(capabilityFor('watch_time', 'instagram')),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The module is pure
// ---------------------------------------------------------------------------

describe('a client component can import the module', () => {
  it('imports nothing but types', () => {
    const imports = [
      ...read(MODULE).matchAll(/^\s*(import\b[^;]*;|.*\brequire\(.*)$/gm),
    ].map(([statement]) => statement!.trim());

    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((line) => !line.startsWith('import type '))).toEqual(
      [],
    );
  });

  it('is exported from the client-safe barrel', () => {
    expect(read('packages/clickhouse/src/index.ts')).toContain(
      "from './lib/data-provenance'",
    );
  });
});

// ---------------------------------------------------------------------------
// (b) Writer binding — the load-bearing one
// ---------------------------------------------------------------------------

describe('every writer is accounted for', () => {
  const tables = Object.keys(TABLE_WRITERS) as SourceTable[];

  it('finds the code it is scanning', () => {
    // Guards the guard: a walk that silently found nothing would make every
    // "no unlisted caller" assertion below pass.
    expect(CODE.length).toBeGreaterThan(500);
    expect(CODE.map(repoPath)).toContain(MODULE);
  });

  it('lists call sites for every table the matrix can name', () => {
    expect(Object.keys(WRITER_CALL_SITES).sort()).toEqual([...tables].sort());
  });

  it.each(tables)(
    '%s: the listed files, and only those, call its writer',
    (table) => {
      // A call, not a mention: the definition and the barrel's re-export do
      // not count. Bound to call sites rather than to `platform:` literals,
      // which would stop seeing a writer the day someone passed a variable.
      const callers = filesContaining(
        new RegExp(`(?<!function\\s+)\\b${TABLE_WRITERS[table]}\\s*\\(`),
      );

      expect(
        callers,
        `${TABLE_WRITERS[table]} is called from a different set of files than ` +
          `WRITER_CALL_SITES.${table} lists. If a platform has started or ` +
          `stopped writing ${table}, CAPABILITY_MATRIX changes in this same ` +
          `pull request — ${MODULE}`,
      ).toEqual([...WRITER_CALL_SITES[table]].sort());
    },
  );

  it.each(tables)('%s: nothing inserts into it except its writer', (table) => {
    // Otherwise a second door — `client.insert({ table: … })` from anywhere —
    // would carry rows past every call-site list above.
    const inserters = filesContaining(
      new RegExp(`\\.insert\\(\\{\\s*table:\\s*['"\`]${table}['"\`]`),
    );

    expect(inserters).toHaveLength(1);
    expect(read(inserters[0]!)).toContain(`function ${TABLE_WRITERS[table]}(`);
  });
});

describe('an absent entry stays absent only while nothing collects it', () => {
  it('has a marker for the two entries the spec names', () => {
    const marked = INGESTION_MARKERS.map(
      ({ family, platform }) => `${family} × ${platform}`,
    );

    expect(marked).toContain('watch_time × instagram');
    expect(marked).toContain('revenue × youtube');
  });

  it.each(INGESTION_MARKERS)(
    '$family × $platform agrees with whether "$marker" is in the code',
    ({ family, platform, within, marker, proves }) => {
      const root = join(REPO, within);

      expect(existsSync(root), `${within} does not exist`).toBe(true);

      const files = statSync(root).isDirectory()
        ? sourceFiles(root, ['.ts', '.tsx'])
        : [root];

      expect(files.length).toBeGreaterThan(0);

      const present =
        filesContaining(new RegExp(escape(marker)), files).length > 0;
      const capability = capabilityFor(family, platform);
      const hasData = ['native', 'derived'].includes(capability.level);

      const hint =
        `"${marker}" is ${present ? 'now' : 'not'} in ${within}. Starting to ` +
        `collect ${family} for ${platform} and moving its matrix entry are ` +
        `one change — ${MODULE}`;

      if (proves === 'requested') {
        expect(hasData, hint).toBe(present);
      } else {
        expect(capability.access !== 'scope_missing', hint).toBe(present);
        // Never `native` while the scope is absent: a zero that was never
        // measured is not a measurement.
        if (!present) expect(hasData, hint).toBe(false);
      }
    },
  );
});

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
