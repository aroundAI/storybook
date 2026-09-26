import { execFileSync } from 'node:child_process';
import { globSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '../../..');
const SUPABASE_DIR = join(REPO, 'apps/web/supabase');
const CONFIG = readFileSync(join(SUPABASE_DIR, 'config.toml'), 'utf8');

/**
 * KB-4. `supabase db diff` builds its target from `[db.migrations]
 * schema_paths`, and `schemas/` is missing a third of the tables, so a diff
 * against it proposes dropping them. Deleting the key is not enough: with no
 * `schema_paths`, CLI 2.117.0 walks `supabase/schemas/` by default
 * (`internal/db/diff/diff.go`, `loadDeclaredSchemas`), which is where ours
 * lives. The key must be present and match nothing, so `db diff` stops with
 * "no files matched pattern".
 */
describe('config.toml keeps `db diff` away from schemas/ (KB-4)', () => {
  const block = /\[db\.migrations\][^[]*?schema_paths\s*=\s*\[([^\]]*)\]/.exec(
    CONFIG,
  );
  const globs = [...(block?.[1] ?? '').matchAll(/"([^"]+)"|'([^']+)'/g)].map(
    (m) => m[1] ?? m[2] ?? '',
  );

  it('sets schema_paths, so the CLI does not fall back to supabase/schemas/', () => {
    expect(globs.length).toBeGreaterThan(0);
  });

  it('every schema_paths glob matches no file', () => {
    const matched = globs.flatMap((glob) =>
      globSync(glob.replace(/^\.\//, ''), { cwd: SUPABASE_DIR }).map(
        (file) => `${glob} → ${file}`,
      ),
    );
    expect(matched, 'files db diff would read').toEqual([]);
  });
});

/**
 * KB-5. This repo moved local Supabase off the default 5432x ports to 5532x,
 * and the README, the in-app docs and the MCP server's database tool kept
 * the old ones. Any local Supabase port named in docs or dev tooling must be
 * one config.toml sets.
 */
describe('docs name the local Supabase ports config.toml sets (KB-5)', () => {
  const configured = new Set(
    [
      ...CONFIG.matchAll(
        /^\s*(?:port|smtp_port|pop3_port|shadow_port)\s*=\s*(\d+)/gm,
      ),
    ].map((m) => m[1]),
  );

  // Local CI's lane B runs a second stack on ports it exports over config.toml
  const laneB = readFileSync(join(REPO, 'scripts/local-ci/lane.sh'), 'utf8');
  for (const m of laneB.matchAll(/\bSUPABASE_[A-Z0-9_]*PORT=(\d+)/g)) {
    configured.add(m[1]);
  }

  it('reads the ports from config.toml', () => {
    expect(configured).toContain('55321');
  });

  it('no doc or dev tool points at a local port config.toml does not set', () => {
    const files = execFileSync(
      'git',
      [
        'ls-files',
        '*.md',
        '*.mdoc',
        'packages/mcp-server/src',
        'scripts',
        ':!specs/**',
        ':!**/__tests__/**',
      ],
      { cwd: REPO },
    )
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean);

    const stale = files.flatMap((file) =>
      readFileSync(join(REPO, file), 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          [...line.matchAll(/(?:localhost|127\.0\.0\.1):(5[45]\d{3})\b/g)]
            .filter((m) => !configured.has(m[1] ?? ''))
            .map((m) => `${file}:${i + 1} ${m[0]}`),
        ),
    );

    expect(stale, 'local URLs on ports nothing listens on').toEqual([]);
  });
});
