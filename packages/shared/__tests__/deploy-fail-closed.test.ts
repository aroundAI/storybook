import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * KB-2. `scripts/deploy.sh` applied migrations before the build, but carried
 * on when they did not apply — no `supabase` CLI, `supabase link` failing,
 * `supabase db push` failing, no `SUPABASE_PROJECT_REF`, a ClickHouse
 * migration failing — and deployed the app against a schema it does not
 * match. Every one of those must stop the deploy before the build.
 * `DEPLOY_SKIP_MIGRATIONS=1` is the one deliberate way past them.
 *
 * KB-70. The same script refuses a STORAGE_PROVIDER the code does not
 * implement, before anything is migrated or built.
 *
 * The script runs for real under bash, from an empty temporary directory,
 * with every external command (`aws`, `pnpm`, `supabase`, `npx`, `node`,
 * `git`) replaced by a stub that records its arguments. The stage is one no
 * config file exists for, and the environment is built from nothing, so no
 * real configuration or credential can reach it.
 */

const SCRIPT = resolve(__dirname, '../../../scripts/deploy.sh');
const root = mkdtempSync(join(tmpdir(), 'kb2-deploy-'));
const bin = join(root, 'bin');
const log = join(root, 'calls.log');

const STUBS: Record<string, string> = {
  aws: `case "$1 $2" in
  "sts get-caller-identity") echo 000000000000 ;;
  "configure get") echo us-east-1 ;;
esac`,
  node: 'echo v22.0.0',
  git: 'echo 0000000',
  pnpm: '[ "$1" = --version ] && echo 10.0.0 && exit 0',
  supabase: `case "$1" in
  --version) echo 2.117.0 ;;
  link) exit "\${FAKE_LINK_EXIT:-0}" ;;
  db) exit "\${FAKE_PUSH_EXIT:-0}" ;;
esac`,
  npx: 'exit "${FAKE_CLICKHOUSE_EXIT:-0}"',
};

mkdirSync(bin);
for (const [name, body] of Object.entries(STUBS)) {
  const file = join(bin, name);
  writeFileSync(
    file,
    `#!/bin/bash\necho "${name} $*" >> "$FAKE_LOG"\n${body}\nexit 0\n`,
  );
  chmodSync(file, 0o755);
}
mkdirSync(join(root, 'work/apps/web'), { recursive: true });
mkdirSync(join(root, 'work/node_modules'));
mkdirSync(join(root, 'work/packages/clickhouse/src/migrations'), {
  recursive: true,
});
writeFileSync(
  join(root, 'work/packages/clickhouse/src/migrations/001_example.ts'),
  '',
);

afterAll(() => rmSync(root, { recursive: true, force: true }));

interface Run {
  status: number | null;
  calls: string[];
  output: string;
}

function deploy(
  env: Record<string, string>,
  { withSupabase = true } = {},
): Run {
  rmSync(log, { force: true });
  const binDir = withSupabase ? bin : join(root, 'bin-no-supabase');
  if (!withSupabase) {
    mkdirSync(binDir, { recursive: true });
    for (const name of Object.keys(STUBS).filter((n) => n !== 'supabase')) {
      writeFileSync(join(binDir, name), readFileSync(join(bin, name)));
      chmodSync(join(binDir, name), 0o755);
    }
  }
  const result = spawnSync('/bin/bash', [SCRIPT, 'kbtest'], {
    cwd: join(root, 'work'),
    encoding: 'utf8',
    env: {
      PATH: `${binDir}:/usr/bin:/bin`,
      HOME: root,
      FAKE_LOG: log,
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.invalid',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test',
      SUPABASE_SERVICE_ROLE_KEY: 'test',
      ...env,
    },
  });
  let calls: string[] = [];
  try {
    calls = readFileSync(log, 'utf8').trim().split('\n');
  } catch {
    calls = [];
  }
  return {
    status: result.status,
    calls,
    output: result.stdout + result.stderr,
  };
}

const MIGRATIONS = {
  SUPABASE_PROJECT_REF: 'kbtestref',
  SUPABASE_DB_PASSWORD: 'test',
  SUPABASE_ACCESS_TOKEN: 'test',
};

const built = (run: Run) =>
  run.calls.some((c) => c.startsWith('pnpm --filter web build'));
const shipped = (run: Run) =>
  run.calls.some((c) => c.startsWith('pnpm sst deploy'));

describe('deploy.sh stops before the build when migrations do not apply (KB-2)', () => {
  it('positive control: migrations apply, then the build, then sst deploy', () => {
    const run = deploy(MIGRATIONS);
    expect(run.status, run.output).toBe(0);
    const order = [
      'supabase link',
      'supabase db push',
      'pnpm --filter web build',
      'pnpm sst deploy',
    ].map((prefix) => run.calls.findIndex((c) => c.startsWith(prefix)));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it.each([
    ['SUPABASE_PROJECT_REF is not set', {}, true],
    ['the supabase CLI is not installed', MIGRATIONS, false],
    ['supabase link fails', { ...MIGRATIONS, FAKE_LINK_EXIT: '1' }, true],
    ['supabase db push fails', { ...MIGRATIONS, FAKE_PUSH_EXIT: '1' }, true],
    [
      'a ClickHouse migration fails',
      {
        ...MIGRATIONS,
        CLICKHOUSE_ENABLED: 'true',
        CLICKHOUSE_HOST: 'http://example.invalid',
        FAKE_CLICKHOUSE_EXIT: '1',
      },
      true,
    ],
  ] as const)(
    '%s → exits non-zero, builds nothing, ships nothing',
    (_label, env, withSupabase) => {
      const run = deploy({ ...env }, { withSupabase });
      expect(run.status, run.output).not.toBe(0);
      expect(built(run), 'the app was built').toBe(false);
      expect(shipped(run), 'sst deploy ran').toBe(false);
      expect(run.output).toMatch(/not deploying/);
    },
  );

  it('ClickHouse migrations that apply let the deploy through', () => {
    const run = deploy({
      ...MIGRATIONS,
      CLICKHOUSE_ENABLED: 'true',
      CLICKHOUSE_HOST: 'http://example.invalid',
    });
    expect(run.status, run.output).toBe(0);
    expect(shipped(run)).toBe(true);
  });

  it('DEPLOY_SKIP_MIGRATIONS=1 skips migrations deliberately, and says so', () => {
    const run = deploy({ DEPLOY_SKIP_MIGRATIONS: '1' });
    expect(run.status, run.output).toBe(0);
    expect(run.calls.some((c) => c.startsWith('supabase'))).toBe(false);
    expect(shipped(run)).toBe(true);
    expect(run.output).toMatch(
      /DEPLOY_SKIP_MIGRATIONS=1 — migrations NOT applied/,
    );
  });
});

describe('deploy.sh refuses a storage provider the code does not implement (KB-70)', () => {
  it.each(['s3', 'local', 'b2'])(
    'STORAGE_PROVIDER=%s → stops before migrating or building',
    (value) => {
      const run = deploy({ ...MIGRATIONS, STORAGE_PROVIDER: value });
      expect(run.status, run.output).not.toBe(0);
      expect(run.calls.some((c) => c.startsWith('supabase'))).toBe(false);
      expect(built(run)).toBe(false);
      expect(run.output).toMatch(/STORAGE_PROVIDER/);
    },
  );

  it.each(['r2', 'supabase'])('STORAGE_PROVIDER=%s deploys', (value) => {
    const run = deploy({ ...MIGRATIONS, STORAGE_PROVIDER: value });
    expect(run.status, run.output).toBe(0);
    expect(shipped(run)).toBe(true);
  });
});
