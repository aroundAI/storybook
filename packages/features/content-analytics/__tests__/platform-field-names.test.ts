import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * FILM-1721. A metric name may not appear in a request or a type unless
 * `docs/platform-capability-reference.md` documents it with a vendor citation.
 *
 * The rule exists because the first draft of phase 17 took platform claims from
 * our own TypeScript declarations, and was wrong in five places on TikTok alone.
 * `TikTokVideoData` declared `save_count`, `average_watch_time`,
 * `total_play_time`, `full_video_watched_rate` and `traffic_source_types`; the
 * endpoint it was used with has none of them, so four metrics resolved to zero
 * and looked measured.
 *
 * Everything here is parsed out of the document. Nothing is restated in this
 * file, so deleting a line from the reference must fail a request that needs it.
 */

const REPO = resolve(__dirname, '../../../..');
const REFERENCE = 'docs/platform-capability-reference.md';

const doc = readFileSync(join(REPO, REFERENCE), 'utf8');

/** Blocks tagged `<!-- fields: <platform>/<surface> -->`, keyed by platform. */
function documentedNames() {
  const byPlatform = new Map<string, Set<string>>();
  const block = /<!-- fields: (\S+) -->\s*```text\n([\s\S]*?)```/g;

  for (const [, key, body] of doc.matchAll(block)) {
    const platform = key!.split('/')[0]!;
    const names = byPlatform.get(platform) ?? new Set<string>();

    for (const line of body!.split('\n')) {
      const name = line.split('#')[0]!.trim();

      if (name) names.add(name);
    }

    byPlatform.set(platform, names);
  }

  return byPlatform;
}

/**
 * The `<!-- forbidden -->` block: `scope  wrong -> right  reason`.
 *
 * `scope` is a `|`-separated list of path fragments the rule applies to. A
 * deprecation is a fact about one vendor, not about the word: LinkedIn reports
 * a genuine `impressions`, so Meta's 2025-04-21 removal must not reach it.
 */
function forbiddenNames() {
  const body = /<!-- forbidden -->\s*```text\n([\s\S]*?)```/.exec(doc)?.[1];

  if (!body) throw new Error(`No forbidden block in ${REFERENCE}`);

  return body
    .split('\n')
    .map((line) => /^(\S+)\s+(\S+)\s*->\s*(\S+)\s+(.*)$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(([, scope, name, replacement, reason]) => ({
      scope: new RegExp(`/(?:${scope!})[./]`),
      name: name!,
      replacement: replacement!,
      reason: reason!.trim(),
    }));
}

const DOCUMENTED = documentedNames();
const FORBIDDEN = forbiddenNames();

/**
 * Every place our code names a vendor field, declared explicitly.
 *
 * Declared rather than inferred for the reason FILM-1703's writer-binding test
 * gives: a regex loose enough to find every request site on its own also finds
 * `breakdown: 'country,city,age,gender'`, which is not a metric. The
 * undeclared-site test below is what stops this list going stale.
 *
 * Each capture group delimits a region. A region containing a quote yields its
 * quoted literals; one without is a bare `fields=a,b,c` list.
 */
const PROVIDERS = 'packages/features/content-analytics/src/providers';

const REQUEST_SITES = [
  {
    platform: 'youtube',
    file: `${PROVIDERS}/youtube/youtube-analytics.ts`,
    patterns: [
      /\bmetrics:\s*(\[[\s\S]*?\]|'[^']*')/g,
      /\bdimensions:\s*('[^']*')/g,
    ],
  },
  {
    platform: 'youtube',
    file: `${PROVIDERS}/youtube/youtube-reporting.ts`,
    patterns: [/YOUTUBE_REPORT_TYPES\s*=\s*(\[[\s\S]*?\])/g],
  },
  {
    platform: 'tiktok',
    file: `${PROVIDERS}/tiktok/tiktok-analytics.ts`,
    patterns: [/\?fields=([a-z_,]+)/g],
  },
  {
    platform: 'instagram',
    file: `${PROVIDERS}/instagram/instagram-insights.ts`,
    patterns: [
      /\?fields=([a-z_,]+)/g,
      /\bmetric:\s*('[^']*')/g,
      /metricsForType\s*=[\s\S]*?\?\s*(\[[^\]]*\])\s*:\s*(\[[^\]]*\])/g,
    ],
  },
] as const;

function namesIn(region: string) {
  if (!region.includes("'")) {
    return region.split(',').map((name) => name.trim());
  }

  return [...region.matchAll(/'([^']*)'/g)].flatMap(([, literal]) =>
    literal!.split(',').map((name) => name.trim()),
  );
}

function lineOf(source: string, index: number) {
  return source.slice(0, index).split('\n').length;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) {
      return entry === '__tests__' || entry === 'node_modules'
        ? []
        : sourceFiles(path);
    }

    return /\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)
      ? [path]
      : [];
  });
}

describe('the reference is readable', () => {
  it('parses a field index', () => {
    const total = [...DOCUMENTED.values()].reduce(
      (count, names) => count + names.size,
      0,
    );

    expect(DOCUMENTED.size).toBeGreaterThanOrEqual(5);
    expect(total).toBeGreaterThan(50);
  });

  it('parses a forbidden list', () => {
    expect(FORBIDDEN.length).toBeGreaterThan(8);
  });

  it('dates every section, in the past', () => {
    const today = new Date().toISOString().slice(0, 10);

    const undated = doc
      .split(/^## /m)
      .slice(1)
      .map((section) => ({
        heading: section.split('\n')[0]!.trim(),
        date: /_Verified: (\d{4}-\d{2}-\d{2})_/.exec(section)?.[1],
      }))
      .filter(({ date }) => date === undefined || date > today)
      .map(
        ({ heading, date }) => `${heading} — ${date ?? 'no _Verified:_ date'}`,
      );

    expect(undated, `In ${REFERENCE}:`).toEqual([]);
  });
});

describe('requests only ask for documented fields', () => {
  it.each(REQUEST_SITES.map((site) => [site.file, site] as const))(
    '%s',
    (_file, site) => {
      const source = readFileSync(join(REPO, site.file), 'utf8');
      const documented = DOCUMENTED.get(site.platform);

      expect(
        documented,
        `${REFERENCE} documents no ${site.platform} fields`,
      ).toBeDefined();

      const undocumented = site.patterns.flatMap((pattern) =>
        [...source.matchAll(pattern)].flatMap((match) =>
          match
            .slice(1)
            .filter((region) => region !== undefined)
            .flatMap((region) => namesIn(region))
            .filter((name) => name && !documented!.has(name))
            .map(
              (name) => `${site.file}:${lineOf(source, match.index)}  ${name}`,
            ),
        ),
      );

      expect(
        undocumented,
        `Not documented for ${site.platform} in ${REFERENCE}. Add a cited row, or stop asking for it:`,
      ).toEqual([]);
    },
  );

  it('every file that builds a request has a declared site', () => {
    const declared = new Set<string>(REQUEST_SITES.map((site) => site.file));

    const undeclared = sourceFiles(join(REPO, PROVIDERS))
      .filter((file) => {
        const source = readFileSync(file, 'utf8');

        return /\?fields=|^\s*(?:metrics?|dimensions):\s*['[]/m.test(source);
      })
      .map((file) => relative(REPO, file))
      .filter((file) => !declared.has(file));

    expect(
      undeclared,
      'These build a vendor request but are unchecked. Add them to REQUEST_SITES:',
    ).toEqual([]);
  });
});

describe('retired names stay gone', () => {
  const ROOTS = [
    PROVIDERS,
    'packages/features/publishing/src/providers',
    'apps/web/lambda/publish-worker/handlers',
  ];

  const files = ROOTS.flatMap((root) => sourceFiles(join(REPO, root)));

  it('finds the files it guards', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(FORBIDDEN.map((entry) => [entry.name, entry] as const))(
    '%s',
    (_name, entry) => {
      // Whole tokens only: `video_thumbnail_impressions` and `adImpressions`
      // are real names that contain a forbidden one.
      const token = new RegExp(
        `(?<![A-Za-z0-9_.])${entry.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`,
      );

      const uses = files
        .filter((file) => entry.scope.test(relative(REPO, file)))
        .flatMap((file) =>
          readFileSync(file, 'utf8')
            .split('\n')
            .map((line, index) => ({ line, index }))
            // Prose may name a retired field; only code uses it.
            .filter(
              ({ line }) => token.test(line) && !/^\s*(\*|\/\/)/.test(line),
            )
            .map(
              ({ line, index }) =>
                `${relative(REPO, file)}:${index + 1}  ${line.trim()}`,
            ),
        );

      expect(
        uses,
        `${entry.name} is retired — use ${entry.replacement} (${entry.reason}). Found in:`,
      ).toEqual([]);
    },
  );
});
