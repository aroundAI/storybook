import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ANALYTICS_SCOPE_REQUIREMENTS,
  REQUESTED_SCOPES,
  isAnalyticsAuthPlatform,
} from '@kit/publishing/oauth/analytics-scopes';
import type { AnalyticsScopeRequirement } from '@kit/publishing/oauth/analytics-scopes';

/**
 * FILM-1711. A provider may not call a vendor endpoint unless a declared
 * requirement covers it, and the OAuth config requests that requirement's
 * scopes.
 *
 * The rule exists because it was broken for nine months without a red build:
 * the TikTok provider called `/v2/video/query/` (needs `video.list`) and the
 * Instagram provider called `/{media-id}/insights` (needs
 * `instagram_manage_insights`) while the OAuth configs asked for neither.
 * Both providers even shipped a `*ScopeError` for the failure this guaranteed.
 *
 * Nothing about scopes is restated here. Calls are found in provider source,
 * requirements come from `analytics-scopes.ts`, requested scopes come from the
 * OAuth configs themselves.
 */

const REPO = resolve(__dirname, '../../../..');
const PROVIDERS = 'packages/features/content-analytics/src/providers';
const REFERENCE = 'docs/platform-capability-reference.md';

/** A provider directory names the platform whose token its calls carry. */
const DIRECTORY_PLATFORM: Record<string, string> = {
  youtube: 'youtube',
  tiktok: 'tiktok',
  instagram: 'instagram',
  facebook: 'facebook',
  twitter: 'twitter',
  x: 'twitter',
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) {
      return entry === '__tests__' || entry === 'node_modules'
        ? []
        : sourceFiles(path);
    }

    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

function repoPath(file: string) {
  return relative(REPO, file).split(sep).join('/');
}

/** Comments blanked out, offsets kept, so a call in prose is not a call. */
function withoutComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, (line, lead: string) =>
      lead.padEnd(line.length, ' '),
    );
}

function lineOf(source: string, index: number) {
  return source.slice(0, index).split('\n').length;
}

interface VendorCall {
  file: string;
  line: number;
  platform: string;
  /** The URL template for a `fetch`, or the client method for googleapis. */
  text: string;
}

/**
 * Every vendor call in the providers: a `fetch(` with its URL, or a method on
 * a googleapis client. A `fetch` whose URL is not written inline cannot be
 * checked, so it is reported with empty text and matches nothing.
 */
function vendorCalls(): VendorCall[] {
  return sourceFiles(join(REPO, PROVIDERS)).flatMap((file) => {
    const path = repoPath(file);
    const directory = path.slice(PROVIDERS.length + 1).split('/')[0]!;
    const platform = DIRECTORY_PLATFORM[directory] ?? `unmapped:${directory}`;
    const source = withoutComments(readFileSync(file, 'utf8'));

    // Meta's calls go through `metaFetch('/path', …)` (FILM-1728).
    const fetches = [...source.matchAll(/\b(?:fetch|metaFetch)\(\s*/g)].map(
      (match) => {
        const start = match.index + match[0].length;
        const url =
          source[start] === '`'
            ? source.slice(start + 1, source.indexOf('`', start + 1))
            : '';

        return {
          file: path,
          line: lineOf(source, match.index),
          platform,
          text: url,
        };
      },
    );

    const clients = [
      ...source.matchAll(/\bthis\.(\w+\.(?:\w+\.)*\w+)\(/g),
    ].flatMap((match) =>
      GOOGLE_CLIENTS.test(match[1]!)
        ? [
            {
              file: path,
              line: lineOf(source, match.index),
              platform,
              text: `${match[1]}(`,
            },
          ]
        : [],
    );

    return [...fetches, ...clients];
  });
}

// `this.youtubeAnalytics.reports.query(`, `this.youtube.videos.list(`,
// `this.reporting.jobs.reports.list(` — fields assigned from `google.*()`.
const GOOGLE_CLIENTS = /^(?:youtubeAnalytics|youtube|reporting)\./;

function requirementsFor(call: VendorCall) {
  return ANALYTICS_SCOPE_REQUIREMENTS.filter(
    (requirement) =>
      requirement.platform === call.platform &&
      requirement.endpoints.some((endpoint) => endpoint.test(call.text)),
  );
}

function unrequested(requirement: AnalyticsScopeRequirement) {
  const requested = new Set(REQUESTED_SCOPES[requirement.platform]);

  return requirement.scopes.filter((scope) => !requested.has(scope));
}

const CALLS = vendorCalls();

describe('the detector sees the providers', () => {
  it('finds vendor calls on every platform with a provider', () => {
    const platforms = new Set(CALLS.map((call) => call.platform));

    expect(CALLS.length).toBeGreaterThanOrEqual(12);
    expect([...platforms].sort()).toEqual([
      'facebook',
      'instagram',
      'tiktok',
      'youtube',
    ]);
  });

  it('maps every provider directory to a platform', () => {
    expect(
      CALLS.filter((call) => !isAnalyticsAuthPlatform(call.platform)).map(
        (call) => `${call.file}:${call.line}  ${call.platform}`,
      ),
      'Add the directory to DIRECTORY_PLATFORM:',
    ).toEqual([]);
  });
});

describe('every vendor call is covered by a declared scope requirement', () => {
  it('has a requirement for each endpoint a provider calls', () => {
    const undeclared = CALLS.filter(
      (call) => requirementsFor(call).length === 0,
    ).map(
      (call) =>
        `${call.file}:${call.line}  ${call.text || '(URL not written inline — the guard cannot read it)'}`,
    );

    expect(
      undeclared,
      'No entry in publishing/src/oauth/analytics-scopes.ts covers these calls. Declare the scopes the endpoint needs, with a vendor citation:',
    ).toEqual([]);
  });

  it('requests every scope those endpoints need', () => {
    const gaps = CALLS.flatMap((call) =>
      requirementsFor(call).flatMap((requirement) =>
        unrequested(requirement).map(
          (scope) =>
            `${call.file}:${call.line}  ${call.text}  needs ${scope} (${requirement.id}), which the ${requirement.platform} OAuth config does not request`,
        ),
      ),
    );

    expect(gaps).toEqual([]);
  });

  it('requests the scope behind every scope-gated metric a provider names', () => {
    const gaps = ANALYTICS_SCOPE_REQUIREMENTS.flatMap((requirement) =>
      (requirement.metrics ?? []).flatMap((metric) => {
        const named = namedIn(requirement.platform, metric);

        return named.length > 0
          ? unrequested(requirement).map(
              (scope) =>
                `${named[0]}  ${metric} needs ${scope} (${requirement.id}), which the OAuth config does not request`,
            )
          : [];
      }),
    );

    expect(gaps).toEqual([]);
  });

  it('marks a requirement implemented once a provider calls its endpoint', () => {
    const premature = CALLS.flatMap((call) =>
      requirementsFor(call)
        .filter((requirement) => requirement.provider !== 'implemented')
        .map(
          (requirement) =>
            `${call.file}:${call.line} calls ${requirement.id}, still declared as planned in ${requirement.provider}`,
        ),
    );

    expect(premature).toEqual([]);
  });

  it('has no implemented requirement that nothing calls', () => {
    const stale = ANALYTICS_SCOPE_REQUIREMENTS.filter(
      (requirement) =>
        requirement.provider === 'implemented' &&
        !CALLS.some((call) => requirementsFor(call).includes(requirement)) &&
        !(requirement.metrics ?? []).some(
          (metric) => namedIn(requirement.platform, metric).length > 0,
        ),
    ).map((requirement) => requirement.id);

    expect(
      stale,
      'Declared as implemented, but no provider calls it. A scope we request and do not use is a consent-screen line we cannot justify:',
    ).toEqual([]);
  });
});

/** Where a provider names `metric` as a string literal, in code. */
function namedIn(platform: string, metric: string) {
  const literal = new RegExp(`['"\`,]${metric}['"\`,]`);

  return sourceFiles(join(REPO, PROVIDERS)).flatMap((file) => {
    const path = repoPath(file);
    const directory = path.slice(PROVIDERS.length + 1).split('/')[0]!;

    if (DIRECTORY_PLATFORM[directory] !== platform) return [];

    const source = withoutComments(readFileSync(file, 'utf8'));
    const lines = source.split('\n');

    return lines.flatMap((line, index) =>
      literal.test(line) ? [`${path}:${index + 1}`] : [],
    );
  });
}

describe('a scope-gated metric travels alone', () => {
  // A revenue metric in the same reports.query as views means a channel
  // without the monetary scope (or outside the Partner Program) loses its
  // totals along with its revenue.
  it('never shares a metrics list with a metric that needs no extra scope', () => {
    const gated = new Set(
      ANALYTICS_SCOPE_REQUIREMENTS.flatMap(
        (requirement) => requirement.metrics ?? [],
      ),
    );

    const mixed = sourceFiles(join(REPO, PROVIDERS)).flatMap((file) => {
      const source = withoutComments(readFileSync(file, 'utf8'));

      // Inline lists (`metrics: [...]`) and named ones (`const DAILY_METRICS =
      // [...]`, joined into a query): FILM-1712 moved YouTube's totals onto
      // the daily query, whose list is a constant.
      return [
        ...source.matchAll(/\bmetrics:\s*(\[[\s\S]*?\]|'[^']*'|"[^"]*")/g),
        ...source.matchAll(/\bconst\s+\w*METRICS\w*\s*=\s*(\[[\s\S]*?\])/g),
      ].flatMap((match) => {
        const names = [...match[1]!.matchAll(/[A-Za-z_]\w*/g)].map(
          ([name]) => name,
        );
        const gatedNames = names.filter((name) => gated.has(name));

        return gatedNames.length > 0 && gatedNames.length < names.length
          ? [
              `${repoPath(file)}:${lineOf(source, match.index)}  ${names.join(',')}`,
            ]
          : [];
      });
    });

    expect(mixed).toEqual([]);
  });
});

describe('the declaration is traceable', () => {
  const doc = readFileSync(join(REPO, REFERENCE), 'utf8');

  it('names only scopes the capability reference documents', () => {
    const untraceable = ANALYTICS_SCOPE_REQUIREMENTS.flatMap((requirement) =>
      requirement.scopes
        .map((scope) => scope.split('/').pop()!)
        .filter((scope) => !doc.includes(`\`${scope}\``))
        .map((scope) => `${requirement.id}: ${scope}`),
    );

    expect(
      untraceable,
      `Not in ${REFERENCE}. Add the scope there with its vendor citation first:`,
    ).toEqual([]);
  });

  it('covers all five platforms, including the two with no provider yet', () => {
    expect(
      [
        ...new Set(
          ANALYTICS_SCOPE_REQUIREMENTS.map(({ platform }) => platform),
        ),
      ].sort(),
    ).toEqual(['facebook', 'instagram', 'tiktok', 'twitter', 'youtube']);
  });

  it('never names video.query, which is an endpoint and not a scope', () => {
    const everyScope = [
      ...Object.values(REQUESTED_SCOPES).flat(),
      ...ANALYTICS_SCOPE_REQUIREMENTS.flatMap(({ scopes }) => scopes),
    ];

    expect(everyScope).not.toContain('video.query');
    expect(REQUESTED_SCOPES.tiktok).toContain('video.list');
  });
});
