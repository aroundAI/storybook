import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * FILM-1904, two source-scan guards:
 *
 * 1. `packages/mcp-server` is a stdio developer tool with SQL execution. It
 *    must never be reachable from the web app, so no source under apps/web
 *    or any package the app depends on imports it. (Its own directory and
 *    tests are exempt; so is this file.)
 *
 * 2. A tool handler gets one database client, the principal's RLS-scoped
 *    one. Nothing under this package's `src/server/tools/` may import a
 *    service-role client, directly or through the lambda admin client.
 *
 * 3. FILM-1906: ClickHouse has no row-level security, so nothing in this
 *    package may import `@kit/clickhouse` (root or any subpath); analytics
 *    reach it only through `@kit/content-analytics` services, which prove
 *    the scope on the principal's client first. The package's ESLint config
 *    carries the same rule; this scan runs where lint is scoped out.
 */

const REPO = resolve(__dirname, '../../../..');
const ROOTS = ['apps/web', 'packages'];
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.turbo',
  '.open-next',
  '.sst',
  'dist',
  'build',
  'coverage',
]);
const SOURCE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const TEST_FILE =
  /(?:^|\/)(?:__tests__|__mocks__|e2e)\/|\.(?:test|spec)\.[jt]sx?$/;

function sourceFiles(path: string): string[] {
  const absolute = join(REPO, path);

  if (!statSync(absolute).isDirectory()) return SOURCE.test(path) ? [path] : [];

  return readdirSync(absolute).flatMap((entry) =>
    SKIP_DIRS.has(entry) ? [] : sourceFiles(join(path, entry)),
  );
}

const FILES = ROOTS.flatMap(sourceFiles)
  .map((file) => relative(REPO, join(REPO, file)).split(sep).join('/'))
  .filter((file) => !TEST_FILE.test(file));

/** `from 'x'`, a bare `import 'x'`, `import('x')` or `require('x')`. */
const IMPORT_OF = (spec: RegExp) =>
  new RegExp(
    `(?:\\bfrom\\s*|\\bimport\\s*\\(?\\s*|\\brequire\\s*\\(\\s*)['"]${spec.source}['"]`,
    'g',
  );

const DEV_MCP_SERVER = IMPORT_OF(
  /(?:@kit\/mcp-server|[./]*packages\/mcp-server)(?:\/[^'"]*)?/,
);
const ADMIN_CLIENT = IMPORT_OF(
  /@kit\/supabase\/(?:server-admin-client|lambda-admin-client)|[./]*(?:server|lambda)-admin-client/,
);
const CLICKHOUSE = IMPORT_OF(
  /(?:@kit\/clickhouse|[./]*packages\/clickhouse)(?:\/[^'"]*)?/,
);

function offenders(files: string[], pattern: RegExp) {
  return files.flatMap((file) => {
    const source = readFileSync(join(REPO, file), 'utf8');

    return [...source.matchAll(pattern)].map(
      (match) => `${file}:${source.slice(0, match.index).split('\n').length}`,
    );
  });
}

describe('nothing reachable from apps/web imports packages/mcp-server', () => {
  const candidates = FILES.filter(
    (file) => !file.startsWith('packages/mcp-server/'),
  );

  it('scans the sources it claims to', () => {
    expect(candidates.length).toBeGreaterThan(1000);
    expect(candidates).toContain('apps/web/app/api/mcp/route.ts');
    expect(candidates).toContain(
      'packages/features/studio-mcp/src/server/route-handler.ts',
    );
    expect(
      candidates.some((file) => file.startsWith('packages/mcp-server/')),
    ).toBe(false);
  });

  it('would catch an import of the dev server', () => {
    expect(
      offendersIn(`import { x } from '@kit/mcp-server';`, DEV_MCP_SERVER),
    ).toBe(1);
    expect(
      offendersIn(
        `const s = await import("../../packages/mcp-server/src/index")`,
        DEV_MCP_SERVER,
      ),
    ).toBe(1);
    // A side-effect import has no `from`; the first version of this guard missed it.
    expect(offendersIn(`import '@kit/mcp-server';`, DEV_MCP_SERVER)).toBe(1);
    expect(
      offendersIn(`require('@kit/mcp-server/build/index.js')`, DEV_MCP_SERVER),
    ).toBe(1);
    expect(
      offendersIn(
        `import { s } from '@kit/studio-mcp/server';`,
        DEV_MCP_SERVER,
      ),
    ).toBe(0);
  });

  it('finds no such import', { timeout: 60_000 }, () => {
    expect(offenders(candidates, DEV_MCP_SERVER)).toEqual([]);
  });
});

describe('tool handlers cannot obtain a service-role client', () => {
  const tools = FILES.filter((file) =>
    file.startsWith('packages/features/studio-mcp/src/server/tools/'),
  );

  it('scans the tools directory', () => {
    expect(tools).toContain(
      'packages/features/studio-mcp/src/server/tools/whoami.ts',
    );
  });

  it('would catch an admin client import', () => {
    expect(
      offendersIn(
        `import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';`,
        ADMIN_CLIENT,
      ),
    ).toBe(1);
    expect(
      offendersIn(`import { a } from '../user-client';`, ADMIN_CLIENT),
    ).toBe(0);
  });

  it('finds none under src/server/tools', () => {
    expect(offenders(tools, ADMIN_CLIENT)).toEqual([]);
  });
});

describe('nothing in @kit/studio-mcp imports @kit/clickhouse', () => {
  const sources = FILES.filter((file) =>
    file.startsWith('packages/features/studio-mcp/src/'),
  );

  it('scans the package’s sources, the analytics tools included', () => {
    expect(sources).toContain(
      'packages/features/studio-mcp/src/server/tools/analytics/shared.ts',
    );
    expect(sources).toContain(
      'packages/features/studio-mcp/src/server/build-server.ts',
    );
  });

  it('would catch the root, a subpath and a relative path', () => {
    expect(
      offendersIn(
        `import { isClickHouseEnabled } from '@kit/clickhouse/server';`,
        CLICKHOUSE,
      ),
    ).toBe(1);
    expect(
      offendersIn(
        `import { FUNNEL_STAGES } from '@kit/clickhouse';`,
        CLICKHOUSE,
      ),
    ).toBe(1);
    expect(
      offendersIn(
        `const q = await import("../../../../packages/clickhouse/src/server")`,
        CLICKHOUSE,
      ),
    ).toBe(1);
    // The services are the allowed door.
    expect(
      offendersIn(
        `import { getDeepDive } from '@kit/content-analytics/server/deep-dive-service';`,
        CLICKHOUSE,
      ),
    ).toBe(0);
  });

  it('finds no such import in the package', () => {
    expect(offenders(sources, CLICKHOUSE)).toEqual([]);
  });
});

function offendersIn(source: string, pattern: RegExp) {
  return [...source.matchAll(pattern)].length;
}
