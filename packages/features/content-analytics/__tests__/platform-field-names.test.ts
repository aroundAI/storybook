import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
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

/**
 * Blocks tagged `<!-- fields: <platform>/<endpoint> source: <url> -->`, keyed by
 * the whole tag, one endpoint each.
 *
 * Keyed by endpoint rather than platform because a platform is not one
 * contract: TikTok's Display API and Business API are separate apps, and X's
 * two quartile vocabularies live on separate endpoints. Merging them per
 * platform let a Display request ask for a Business-only field and pass.
 *
 * The `source` is required and deliberately weak — it proves someone had a
 * reference page open, not that a name is real. It exists because a name once
 * entered this index from an announcement blog post and nothing noticed.
 */
function documentedNames() {
  const bySurface = new Map<string, Set<string>>();
  const block =
    /<!-- fields: (\S+) source: (https?:\/\/\S+) -->\s*```text\n([\s\S]*?)```/g;

  for (const [, surface, , body] of doc.matchAll(block)) {
    const names = new Set<string>();

    for (const line of body!.split('\n')) {
      const name = line.split('#')[0]!.trim();

      if (name) names.add(name);
    }

    bySurface.set(surface!, names);
  }

  return bySurface;
}

/**
 * The `<!-- forbidden -->` block: `scope  wrong -> right  reason`.
 *
 * `scope` is a `|`-separated list of path segments the rule applies to. A
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
      // A directory or a file stem: `…/tiktok/…`, `…/tiktok.ts`, `…/tiktok-provider.ts`.
      scope: new RegExp(
        `(?:^|/)(?:${scope!.split('|').map(escape).join('|')})(?:/|\\.|-)`,
      ),
      name: name!,
      replacement: replacement!,
      reason: reason!.trim(),
    }));
}

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const DOCUMENTED = documentedNames();
const FORBIDDEN = forbiddenNames();

/**
 * Every place our code names a vendor field, declared explicitly, each with the
 * endpoints it is allowed to draw from.
 *
 * Declared rather than inferred for the reason FILM-1703's writer-binding test
 * gives: a regex loose enough to find every request site on its own also finds
 * `breakdown: 'country,city,age,gender'`, which is not a metric. The detector
 * test below is what stops this list going stale.
 *
 * Each capture group delimits a region. A region containing a quote yields its
 * quoted literals; one without is a bare `fields=a,b,c` list.
 */
const PROVIDERS = 'packages/features/content-analytics/src/providers';

// Up to the next `fetch(`, so a pattern cannot borrow another call's literal.
const WITHIN_CALL = String.raw`(?:(?!fetch\()[\s\S])*?`;
const LITERAL = String.raw`('[^']*'|"[^"]*")`;

const REQUEST_SITES: Array<{
  file: string;
  patterns: Array<{ pattern: RegExp; surfaces: string[] }>;
}> = [
  {
    file: `${PROVIDERS}/youtube/youtube-analytics.ts`,
    patterns: [
      {
        pattern: new RegExp(
          String.raw`\bmetrics:\s*(\[[\s\S]*?\]|${LITERAL.slice(1, -1)})`,
          'g',
        ),
        surfaces: ['youtube/analytics-metrics'],
      },
      {
        pattern: new RegExp(String.raw`\bdimensions:\s*${LITERAL}`, 'g'),
        surfaces: ['youtube/analytics-dimensions'],
      },
      {
        pattern: new RegExp(
          String.raw`\bpart:\s*(\[[^\]]*\]|${LITERAL.slice(1, -1)})`,
          'g',
        ),
        surfaces: ['youtube/data-api'],
      },
    ],
  },
  {
    file: `${PROVIDERS}/youtube/youtube-reporting.ts`,
    patterns: [
      {
        pattern: /YOUTUBE_REPORT_TYPES\s*=\s*(\[[\s\S]*?\])/g,
        surfaces: ['youtube/reporting'],
      },
    ],
  },
  {
    file: `${PROVIDERS}/tiktok/tiktok-analytics.ts`,
    patterns: [
      {
        pattern: /video\/query\/\?fields=([a-z_,]+)/g,
        surfaces: ['tiktok/display-video'],
      },
      {
        pattern: /user\/info\/\?fields=([a-z_,]+)/g,
        surfaces: ['tiktok/display-user'],
      },
    ],
  },
  {
    file: `${PROVIDERS}/instagram/instagram-insights.ts`,
    patterns: [
      {
        pattern: /\$\{mediaId\}\?fields=([a-z_,]+)/g,
        surfaces: ['instagram/media-fields'],
      },
      {
        pattern: /\$\{this\.instagramAccountId\}\?fields=([a-z_,]+)/g,
        surfaces: ['instagram/user-fields'],
      },
      {
        pattern: new RegExp(
          String.raw`\$\{mediaId\}\/insights\?${WITHIN_CALL}\bmetric:\s*${LITERAL}`,
          'g',
        ),
        surfaces: ['instagram/media-insights', 'instagram/media-insights-2026'],
      },
      {
        pattern: new RegExp(
          String.raw`\$\{this\.instagramAccountId\}\/insights\?${WITHIN_CALL}\bmetric:\s*${LITERAL}`,
          'g',
        ),
        surfaces: ['instagram/user-insights'],
      },
      {
        pattern:
          /metricsForType\s*=[^;[]*?(\[[^\]]*\])(?:[^;[]*?(\[[^\]]*\]))?/g,
        surfaces: ['instagram/media-insights', 'instagram/media-insights-2026'],
      },
    ],
  },
];

/**
 * Anything that looks like a literal vendor field list. Every match must fall
 * inside a declared pattern's match, or the request is unchecked.
 *
 * The last alternative catches a list assigned to a variable
 * (`const metricsForType = [...]`), which is invisible to the others. Without
 * it, reshaping a ternary into a single array silently took Instagram's media
 * metrics out of the guard's sight.
 */
const REQUEST_SHAPE =
  /\?(?:fields|metric)=|\b(?:metrics?|dimensions|fields|part)\s*:\s*['"`[]|searchParams\.set\(\s*['"](?:fields|metric)['"]|\b\w*(?:[mM]etric|[fF]ield)\w*\s*=\s*\[/g;

function namesIn(region: string) {
  if (!/['"]/.test(region)) {
    return region.split(',').map((name) => name.trim());
  }

  return [...region.matchAll(/'([^']*)'|"([^"]*)"/g)].flatMap(
    ([, single, double]) =>
      (single ?? double)!.split(',').map((name) => name.trim()),
  );
}

function lineOf(source: string, index: number) {
  return source.slice(0, index).split('\n').length;
}

function repoPath(file: string) {
  return relative(REPO, file).split(sep).join('/');
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

/**
 * Code lines only: comment lines, the inside of block comments and trailing
 * `//` comments are removed. Prose may name a retired field; code may not.
 * `https://` keeps its `//`, because a `:` precedes it.
 */
function codeLines(source: string) {
  let inBlock = false;

  return source.split('\n').map((raw, index) => {
    let line = raw;

    if (inBlock) {
      const end = line.indexOf('*/');

      if (end === -1) return { line: '', index };

      line = line.slice(end + 2);
      inBlock = false;
    }

    line = line.replace(/\/\*.*?\*\//g, '');

    const open = line.indexOf('/*');

    if (open !== -1) {
      line = line.slice(0, open);
      inBlock = true;
    }

    if (/^\s*\*/.test(line)) line = '';

    return { line: line.replace(/(^|[^:])\/\/.*$/, '$1'), index };
  });
}

/** A `YYYY-MM-DD` that names a real day, not one a regex happens to accept. */
function isRealDate(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);

  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date)
  );
}

describe('the reference is readable', () => {
  it('parses a field index, one endpoint per block', () => {
    const total = [...DOCUMENTED.values()].reduce(
      (count, names) => count + names.size,
      0,
    );

    expect(DOCUMENTED.size).toBeGreaterThanOrEqual(10);
    expect(total).toBeGreaterThan(50);
  });

  it('cites a source for every field block', () => {
    const tagged = [...doc.matchAll(/<!-- fields: (\S+)([^>]*)-->/g)].map(
      ([, key, rest]) => ({ key: key!, rest: rest! }),
    );

    const uncited = tagged
      .filter(({ rest }) => !/\bsource: https?:\/\//.test(rest))
      .map(({ key }) => key);

    expect(tagged.length).toBe(DOCUMENTED.size);
    expect(
      uncited,
      `Every field block needs \`source: <url>\` in its tag. Missing on:`,
    ).toEqual([]);
  });

  it('parses a forbidden list', () => {
    expect(FORBIDDEN.length).toBeGreaterThan(8);
  });

  it('dates every section with a real day, no later than anywhere on Earth today', () => {
    // UTC+14 is the furthest ahead any timezone runs, so an author writing
    // their local "today" never trips this.
    const latest = new Date(Date.now() + 14 * 3600_000)
      .toISOString()
      .slice(0, 10);

    const undated = doc
      .split(/^## /m)
      .slice(1)
      .map((section) => ({
        heading: section.split('\n')[0]!.trim(),
        date: /_Verified: (\d{4}-\d{2}-\d{2})_/.exec(section)?.[1],
      }))
      .filter(
        ({ date }) => date === undefined || !isRealDate(date) || date > latest,
      )
      .map(
        ({ heading, date }) => `${heading} — ${date ?? 'no _Verified:_ date'}`,
      );

    expect(undated, `In ${REFERENCE}:`).toEqual([]);
  });
});

describe('requests only ask for documented fields, on the endpoint they call', () => {
  it.each(REQUEST_SITES.map((site) => [site.file, site] as const))(
    '%s',
    (_file, site) => {
      const source = readFileSync(join(REPO, site.file), 'utf8');

      const undocumented = site.patterns.flatMap(({ pattern, surfaces }) => {
        const unknown = surfaces.filter((surface) => !DOCUMENTED.has(surface));

        if (unknown.length > 0) {
          return [
            `${site.file}: no block in ${REFERENCE} for ${unknown.join(', ')}`,
          ];
        }

        const allowed = new Set(
          surfaces.flatMap((s) => [...DOCUMENTED.get(s)!]),
        );

        return [...source.matchAll(pattern)].flatMap((match) =>
          match
            .slice(1)
            .filter((region) => region !== undefined)
            .flatMap((region) => namesIn(region))
            .filter((name) => name && !allowed.has(name))
            .map(
              (name) =>
                `${site.file}:${lineOf(source, match.index)}  ${name}  (allowed: ${surfaces.join(', ')})`,
            ),
        );
      });

      expect(
        undocumented,
        `Not documented for the endpoint these requests call. Add a cited row to that endpoint's block, or stop asking for it:`,
      ).toEqual([]);
    },
  );

  it('every literal field list sits inside a declared request site', () => {
    const declared = new Map(REQUEST_SITES.map((site) => [site.file, site]));

    const unchecked = sourceFiles(join(REPO, PROVIDERS)).flatMap((file) => {
      const path = repoPath(file);
      const source = readFileSync(file, 'utf8');
      const spans = (declared.get(path)?.patterns ?? []).flatMap(
        ({ pattern }) =>
          [...source.matchAll(pattern)].map((m) => [
            m.index,
            m.index + m[0].length,
          ]),
      );

      return [...source.matchAll(REQUEST_SHAPE)]
        .filter(
          (m) => !spans.some(([from, to]) => m.index >= from! && m.index < to!),
        )
        .map((m) => `${path}:${lineOf(source, m.index)}  ${m[0]}`);
    });

    expect(
      unchecked,
      'These build a vendor request the guard cannot see. Declare a pattern for each in REQUEST_SITES:',
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
      // Whole tokens: `video_thumbnail_impressions` and `adImpressions` contain
      // a forbidden name and are real. A preceding `.` does NOT shield a
      // match — `video.save_count` is property access, and property access
      // was the original bug.
      const token = new RegExp(
        `(?<![A-Za-z0-9_])${escape(entry.name)}(?![A-Za-z0-9_])`,
      );

      const uses = files
        .filter((file) => entry.scope.test(repoPath(file)))
        .flatMap((file) =>
          codeLines(readFileSync(file, 'utf8'))
            .filter(({ line }) => token.test(line))
            .map(
              ({ line, index }) =>
                `${repoPath(file)}:${index + 1}  ${line.trim()}`,
            ),
        );

      expect(
        uses,
        `${entry.name} is retired — use ${entry.replacement} (${entry.reason}). Found in:`,
      ).toEqual([]);
    },
  );
});
