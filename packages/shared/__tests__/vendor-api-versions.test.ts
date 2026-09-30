import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  META_GRAPH_VERSION,
  META_GRAPH_VERSION_EXPIRES,
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
 */
describe('the Graph pin carries the dates the reference documents', () => {
  const doc = readFileSync(join(REPO, REFERENCE), 'utf8');
  const row = new RegExp(
    String.raw`^\| ${META_GRAPH_VERSION.replace('.', '\\.')} \| (\d{4}-\d{2}-\d{2}) \| \**(\d{4}-\d{2}-\d{2})\** \|`,
    'm',
  ).exec(doc);

  it('is a version the reference lists', () => {
    expect(
      row,
      `${META_GRAPH_VERSION} missing from ${REFERENCE}`,
    ).not.toBeNull();
  });

  it('matches the documented release and expiry', () => {
    expect(META_GRAPH_VERSION_RELEASED).toBe(row?.[1]);
    expect(META_GRAPH_VERSION_EXPIRES).toBe(row?.[2]);
  });

  it('names the pin and its expiry where a reader of the reference will see it', () => {
    expect(doc).toContain(
      `**Pinned: \`${META_GRAPH_VERSION}\`, upgrade before ${META_GRAPH_VERSION_EXPIRES}.**`,
    );
  });
});
