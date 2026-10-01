import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  META_GRAPH_VERSION,
  META_GRAPH_VERSION_EXPIRES,
  META_GRAPH_VERSION_EXPIRY_IS_FLOOR,
  META_GRAPH_VERSION_RELEASED,
  VENDORS,
  type Vendor,
} from '../src/vendors';

/**
 * FILM-1723. One pinned API version per vendor, declared once, in
 * `packages/shared/src/vendors/`.
 *
 * The rule is mechanical because the convention decayed: Graph was pinned at
 * v18.0, v19.0 and v23.0 at once, two of them past end-of-life and silently
 * served as v20.0, and X publishing called a host and an upload endpoint that
 * had both been retired. Nobody chose any of that; each literal was correct on
 * the day it was typed.
 *
 * Tests are scanned too. An expectation that restates `…/v18.0/…` keeps passing
 * after the pin moves only if somebody remembers to edit it, which is the same
 * decay one file over.
 *
 * FILM-1801 extends the same scan to every vendor **host**. The list is read
 * from `VENDORS`, not restated, so adding a vendor to the resolver extends the
 * guard. A host written outside the vendors directory is a request the local
 * sandbox cannot intercept, and a second place for a host to go stale. Host
 * rules skip test files: a test may name the real host to assert that it is
 * what comes back.
 */

const REPO = resolve(__dirname, '../../..');
const VENDORS_DIR = 'packages/shared/src/vendors';
const THIS_FILE = 'packages/shared/__tests__/vendor-api-versions.test.ts';
const REFERENCE = 'docs/platform-capability-reference.md';

const ROOTS = ['packages', 'apps', 'sst.config.ts'];
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.turbo',
  '.open-next',
  '.sst',
  'dist',
  'coverage',
  'playwright-report',
  'test-results',
]);
const SOURCE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;

interface Rule {
  name: string;
  pattern: RegExp;
  /** Limits a pattern too generic to apply repo-wide. */
  appliesTo?: RegExp;
  /** Host rules leave tests alone; version rules do not. */
  skipTests?: boolean;
  use: string;
}

const TEST_FILE =
  /(?:^|\/)(?:__tests__|__mocks__|e2e)\/|\.(?:test|spec)\.[jt]sx?$/;

/**
 * Pages a person opens, on hosts that also serve an API or an OAuth dialog:
 * permalinks, share intents, embeds, a footer link, the account settings
 * where a person revokes our access. No credential rides on
 * them and no sandbox should serve them, so they are removed from a line
 * before it is searched. Anything else on these hosts is a vendor call.
 */
const PUBLIC_PAGES = [
  /www\.facebook\.com\/(?:plugins\/video\.php|sharer\/|watch\/|USER\/videos\/|\$\{pageId\}\/videos\/)/g,
  /www\.facebook\.com\$\{data\.permalink_url\}/g,
  /www\.tiktok\.com\/(?:@|creator|embed\/)/g,
  /www\.linkedin\.com\/(?:feed\/update\/|sharing\/share-offsite\/)/g,
  /(?<![\w.-])x\.com\/storybook/g,
  /www\.facebook\.com\/settings/g,
  /(?<![\w.-])x\.com\/settings\//g,
  /www\.linkedin\.com\/mypreferences\//g,
  /archive\.org\/details\//g,
  // An identifier in X's error bodies (`type`), never requested; the sandbox
  // must reproduce it byte for byte, and importing the resolver there would
  // freeze its constants before a test stubs VENDOR_URL_*.
  /api\.x\.com\/2\/problems\//g,
];

const VERSION_RULES: Rule[] = [
  {
    name: 'Meta Graph API host',
    pattern: /graph(?:-video)?\.facebook\.com/,
    use: 'META_GRAPH_BASE or META_GRAPH_VIDEO_BASE',
  },
  {
    name: 'versioned Meta URL',
    pattern: /facebook\.com\/v\d+/,
    use: 'META_GRAPH_BASE or META_OAUTH_DIALOG_URL',
  },
  {
    name: 'Graph version literal',
    pattern: /['"`]v\d{1,2}\.0['"`]/,
    appliesTo:
      /meta|facebook|instagram|token-refresh|publish-worker|platforms/i,
    use: 'META_GRAPH_VERSION',
  },
  {
    // FILM-1728 §7.3.A. With the hosts already confined to this directory,
    // these constants are the only way to build a Graph URL, so a caller that
    // names one is a bare fetch( of Meta that skips the served-version check.
    name: 'Meta Graph URL outside metaFetch',
    pattern: /\bMETA_(?:GRAPH_BASE|GRAPH_VIDEO_BASE|OAUTH_TOKEN_URL)\b/,
    skipTests: true,
    use: "metaFetch('/path', { token })",
  },
  {
    // FILM-1728 §7.4. A token in a URL reaches logs and proxies; metaFetch
    // sends it as Authorization: Bearer.
    name: 'Meta access token in a URL or body',
    pattern:
      /access_token=|\baccess_token['"]?\s*:\s*(?:this\.)?\w*[tT]oken\b|append\(\s*['"]access_token['"]/,
    // The sandbox serves tokens in its responses; it does not send them.
    appliesTo:
      /^(?!apps\/vendor-sandbox\/).*(?:meta|facebook|instagram|token-refresh)/i,
    skipTests: true,
    use: "metaFetch's token option, which sends Authorization: Bearer,",
  },
  {
    name: 'X API host',
    pattern: /(?:api|upload)\.(?:twitter|x)\.com/,
    use: 'X_API_BASE',
  },
  {
    name: 'X OAuth authorize host',
    pattern: /(?:twitter|x)\.com\/i\/oauth2/,
    use: 'X_OAUTH_AUTHORIZE_URL',
  },
  {
    name: 'X v1.1 endpoint',
    pattern: /\/1\.1\/[a-z]/,
    use: 'X_MEDIA_UPLOAD - the v1.1 media upload is retired; X_API_BASE for the rest',
  },
  {
    name: 'LinkedIn version literal',
    pattern: /['"`]20\d{4}['"`]/,
    appliesTo: /linkedin|publish-worker/i,
    use: 'LINKEDIN_REST_VERSION',
  },
];

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * One rule per host in `VENDORS`, matched without its scheme so `http://` and
 * a protocol-relative spelling are caught too. A host FILM-1723's rules
 * already cover is left to them, so a line is reported once.
 */
const HOST_RULES: Rule[] = (Object.entries(VENDORS) as [Vendor, string][])
  .map(([vendor, url]) => ({ vendor, host: new URL(url).host }))
  .filter(({ host }) => !VERSION_RULES.some((rule) => rule.pattern.test(host)))
  .map(({ vendor, host }) => ({
    name: `${vendor} host`,
    pattern: new RegExp(`(?<![\\w.-])${escapeRegExp(host)}(?![\\w-])`),
    skipTests: true,
    use: `vendorUrl('${vendor}')`,
  }));

const RULES = [...VERSION_RULES, ...HOST_RULES];

function withoutPublicPages(line: string) {
  return PUBLIC_PAGES.reduce((rest, page) => rest.replace(page, ''), line);
}

function sourceFiles(path: string): string[] {
  const absolute = join(REPO, path);

  if (!statSync(absolute).isDirectory()) return SOURCE.test(path) ? [path] : [];

  return readdirSync(absolute).flatMap((entry) =>
    SKIP_DIRS.has(entry) ? [] : sourceFiles(join(path, entry)),
  );
}

/**
 * Any rule at all, as one expression. Nearly every line in the repository
 * matches none, and asking once instead of once per rule is what keeps a scan
 * of every source file inside the test timeout.
 */
const ANY_RULE = new RegExp(
  RULES.map((rule) => `(?:${rule.pattern.source})`).join('|'),
);

function violations() {
  return ROOTS.flatMap(sourceFiles)
    .map((file) => relative(REPO, join(REPO, file)).split(sep).join('/'))
    .filter((file) => !file.startsWith(`${VENDORS_DIR}/`) && file !== THIS_FILE)
    .flatMap((file) => {
      const rules = RULES.filter(
        (rule) =>
          (rule.appliesTo?.test(file) ?? true) &&
          !(rule.skipTests && TEST_FILE.test(file)),
      );

      return readFileSync(join(REPO, file), 'utf8')
        .split('\n')
        .flatMap((line, index) => {
          if (!ANY_RULE.test(line)) return [];

          const rest = withoutPublicPages(line);

          return rules
            .filter((rule) => rule.pattern.test(rest))
            .map(
              (rule) =>
                `${file}:${index + 1} ${rule.name} - import ${rule.use} from @kit/shared/vendors`,
            );
        });
    });
}

describe('vendor API versions are declared once (FILM-1723)', () => {
  it('finds files to scan, so an empty result means clean and not unread', () => {
    const files = ROOTS.flatMap(sourceFiles);

    expect(files.length).toBeGreaterThan(1000);
    expect(files).toContain(
      'packages/features/publishing/src/lib/token-refresh.ts',
    );
    expect(files).toContain(
      'apps/web/lambda/publish-worker/handlers/twitter.ts',
    );
  });

  it(
    'has no vendor host or version literal outside packages/shared/src/vendors',
    { timeout: 60_000 },
    () => {
      expect(violations()).toEqual([]);
    },
  );

  it('declares each pin exactly once inside the vendors directory', () => {
    const declared = sourceFiles(VENDORS_DIR)
      .map((file) => readFileSync(join(REPO, file), 'utf8'))
      .join('\n');

    expect(declared.match(/['"`]v\d{1,2}\.0['"`]/g)).toEqual([
      `'${META_GRAPH_VERSION}'`,
    ]);
    expect(declared.match(/https:\/\/api\.(?:twitter|x)\.com/g)).toEqual([
      'https://api.x.com',
    ]);
    expect(declared.match(/['"`]20\d{4}['"`]/g)).toHaveLength(1);
  });
});

/**
 * The doc-comment on `META_GRAPH_VERSION` names a release date and an
 * end-of-life. Those are claims, so they are bound to the table FILM-1721
 * researched rather than trusted: bump the version without its dates, or edit
 * the table without the constant, and this fails.
 *
 * FILM-1728: an expiry Meta has not published yet is entered as the
 * guaranteed floor (two years from release) and labelled `(floor)` in the
 * row, the "Pinned" line and `META_GRAPH_VERSION_EXPIRY_IS_FLOOR` alike, so an
 * inferred date can never pass for a documented one.
 */
const META_FILE = `${VENDORS_DIR}/meta.ts`;
const FLOOR_NOTE = " (a floor: Meta has not published this version's end date)";

function pinnedLine(version: string, expires: string, isFloor: boolean) {
  return `**Pinned: \`${version}\`, upgrade before ${expires}${isFloor ? FLOOR_NOTE : ''}.**`;
}

describe('the Graph pin carries the dates the reference documents', () => {
  const doc = readFileSync(join(REPO, REFERENCE), 'utf8');
  const row = new RegExp(
    String.raw`^\| ${META_GRAPH_VERSION.replace('.', '\\.')} \| (\d{4}-\d{2}-\d{2}) \| \**(\d{4}-\d{2}-\d{2})\**( \(floor\))? \|`,
    'm',
  ).exec(doc);
  const pinned = /^\*\*Pinned: `(v\d+\.0)`/m.exec(doc)?.[1];

  it('is a version the reference lists', () => {
    expect(
      row,
      `${META_GRAPH_VERSION} has no dated row in ${REFERENCE}'s Graph API versions table`,
    ).not.toBeNull();
  });

  it('is the version the reference says is pinned', () => {
    expect(
      META_GRAPH_VERSION,
      `${REFERENCE} pins ${pinned}; META_GRAPH_VERSION in ${META_FILE} says otherwise`,
    ).toBe(pinned);
  });

  it('matches the documented release and expiry', () => {
    expect(META_GRAPH_VERSION_RELEASED).toBe(row?.[1]);
    expect(META_GRAPH_VERSION_EXPIRES).toBe(row?.[2]);
    expect(
      META_GRAPH_VERSION_EXPIRY_IS_FLOOR,
      'the row says (floor) exactly when META_GRAPH_VERSION_EXPIRY_IS_FLOOR does',
    ).toBe(Boolean(row?.[3]));
  });

  it('names the pin and its expiry where a reader of the reference will see it', () => {
    expect(doc).toContain(
      pinnedLine(
        META_GRAPH_VERSION,
        META_GRAPH_VERSION_EXPIRES,
        META_GRAPH_VERSION_EXPIRY_IS_FLOOR,
      ),
    );
  });
});

/**
 * FILM-1728 §7.3.B. An expiry that cannot be missed: this goes red 120 days
 * before a pinned version expires, which is what "not worrying for years"
 * means in practice — a reminder nobody had to set, four months ahead.
 *
 * One entry per vendor that publishes an end date. Today that is only Meta:
 * LinkedIn's monthly versions and X's unversioned v2 have no published one.
 */
const WARN_DAYS = 120;
const DAY_MS = 86_400_000;

interface PinnedExpiry {
  vendor: string;
  version: string;
  expires: string;
  isFloor: boolean;
}

const EXPIRING_PINS: PinnedExpiry[] = [
  {
    vendor: 'Meta Graph',
    version: META_GRAPH_VERSION,
    expires: META_GRAPH_VERSION_EXPIRES,
    isFloor: META_GRAPH_VERSION_EXPIRY_IS_FLOOR,
  },
];

/** Null while more than WARN_DAYS remain; otherwise what to do about it. */
export function expiryProblem(pin: PinnedExpiry, today: Date) {
  const daysLeft = Math.floor(
    (Date.parse(`${pin.expires}T00:00:00Z`) - today.getTime()) / DAY_MS,
  );
  if (daysLeft > WARN_DAYS) return null;

  const files = `${META_FILE}, ${REFERENCE} (the "Pinned" line, the versions table and the findings table), and this test's expectations`;

  return pin.isFloor
    ? `${pin.vendor} ${pin.version}: ${daysLeft} days to ${pin.expires}, which is only the guaranteed floor. Re-read Meta's changelog first: if the next version has shipped, ${pin.version}'s real end date is published and is probably later — enter it and clear the floor flag. Otherwise bump the pin. FILM-1728; files: ${files}.`
    : `${pin.vendor} ${pin.version} expires on ${pin.expires}, in ${daysLeft} days. Bump the pin to a version with at least a year left, reading the changelog of every version crossed. FILM-1728; files: ${files}.`;
}

describe('no pinned vendor version is within 120 days of its end (FILM-1728)', () => {
  it.each(EXPIRING_PINS.map((pin) => [pin.vendor, pin] as const))(
    '%s',
    (_vendor, pin) => {
      expect(expiryProblem(pin, new Date())).toBeNull();
    },
  );

  it('goes red at T-120 days, naming FILM-1728 and the files (fixture date)', () => {
    const pin = { ...EXPIRING_PINS[0]!, expires: '2028-07-29', isFloor: false };
    const at = (iso: string) => expiryProblem(pin, new Date(iso));

    expect(at('2028-03-29T12:00:00Z')).toBeNull();
    expect(at('2028-03-30T12:00:00Z')).toMatch(/in 120 days/);
    expect(at('2028-03-30T12:00:00Z')).toContain('FILM-1728');
    expect(at('2028-03-30T12:00:00Z')).toContain(META_FILE);
    expect(at('2028-03-30T12:00:00Z')).not.toMatch(/floor/);
  });

  it('says to re-read the changelog first when the date is only a floor', () => {
    const floor = {
      ...EXPIRING_PINS[0]!,
      expires: '2028-07-29',
      isFloor: true,
    };

    expect(expiryProblem(floor, new Date('2028-03-30T12:00:00Z'))).toMatch(
      /only the guaranteed floor\. Re-read Meta's changelog first/,
    );
  });
});

/**
 * FILM-1728 §7.3.D. Reading the changelog becomes a checklist item that
 * cannot be skipped: the reference keeps a dated row per Graph version this
 * repository has crossed, and a bump that skips one fails here. The first row
 * is the baseline (FILM-1723's pin); every version from it to the pin needs a
 * row, with the day its changelog was read.
 */
describe('every Graph version crossed has a dated findings row (FILM-1728)', () => {
  const doc = readFileSync(join(REPO, REFERENCE), 'utf8');
  const table =
    /<!-- graph-version-findings -->\n([\s\S]*?)\n\n/.exec(doc)?.[1] ?? '';
  const rows = [
    ...table.matchAll(/^\| v(\d+)\.0 \| (\d{4}-\d{2}-\d{2}) \|/gm),
  ].map(([, major, read]) => ({ major: Number(major), read: read! }));

  it('has the table', () => {
    expect(
      rows.length,
      `no <!-- graph-version-findings --> table in ${REFERENCE}`,
    ).toBeGreaterThan(0);
  });

  it('has a row for every version from the baseline to the pin', () => {
    const pin = Number(META_GRAPH_VERSION.slice(1, -2));
    const first = Math.min(...rows.map((r) => r.major));
    const missing = Array.from(
      { length: pin - first + 1 },
      (_, i) => first + i,
    ).filter((major) => !rows.some((r) => r.major === major));

    expect(
      missing.map((major) => `v${major}.0`),
      `Read each version's changelog (https://developers.facebook.com/docs/graph-api/changelog/version<N>.0) and add a dated row for it`,
    ).toEqual([]);
  });

  it('dates each row with a real day, not in the future', () => {
    const latest = new Date(Date.now() + 14 * 3600_000)
      .toISOString()
      .slice(0, 10);

    expect(
      rows.filter((r) => Number.isNaN(Date.parse(r.read)) || r.read > latest),
    ).toEqual([]);
  });
});
