import { appendFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Sandbox, createSandbox } from '../src/sandbox';
import {
  SOURCE_ROOTS,
  type SandboxVersion,
  sourceStamp,
  stalenessProblem,
} from '../src/version';

/**
 * `/__sandbox/version` and the comparison apps/e2e's `sandboxRun()` makes
 * with it. The sandbox stamps a copy of the source here, so a test can edit
 * a file after the sandbox started, as a person does between two runs.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const FREE_PORTS = {
  control: 0,
  openai: 0,
  gemini: 0,
  elevenlabs: 0,
  meta: 0,
  tiktok: 0,
  google: 0,
  x: 0,
};
const EDITED = 'apps/vendor-sandbox/src/social/vendors/meta/insights.ts';

let copy: string;
let sandbox: Sandbox | undefined;

function start() {
  return createSandbox({ seed: 1, ports: FREE_PORTS, root: copy });
}

async function served(target: Sandbox) {
  const response = await fetch(`${target.urls.control}/__sandbox/version`);
  expect(response.status).toBe(200);
  return (await response.json()) as SandboxVersion;
}

beforeAll(() => {
  copy = mkdtempSync(join(tmpdir(), 'sandbox-version-'));
  for (const path of SOURCE_ROOTS)
    cpSync(join(REPO, path), join(copy, path), { recursive: true });
});

afterAll(async () => {
  await sandbox?.close();
  rmSync(copy, { recursive: true, force: true });
});

describe('sourceStamp', () => {
  it('hashes every file under the roots, and the same tree the same way', () => {
    const stamp = sourceStamp(copy);

    expect(Object.keys(stamp.files)).toContain(EDITED);
    expect(Object.keys(stamp.files)).toContain(
      'packages/features/prompt-engine/src/lib/server/prompt-registry.ts',
    );
    expect(
      Object.keys(stamp.files).some((path) =>
        path.startsWith('packages/features/prompt-engine/src/prompts/'),
      ),
    ).toBe(true);
    expect(stamp.root).toBe(copy);
    expect(sourceStamp(copy).digest).toBe(stamp.digest);
    expect(sourceStamp(REPO).digest).toBe(stamp.digest);
  });
});

describe('/__sandbox/version', () => {
  it('serves the stamp of the source it started from, with its pid', async () => {
    sandbox = await start();
    const version = await served(sandbox);

    expect(version.digest).toBe(sourceStamp(copy).digest);
    expect(version.root).toBe(copy);
    expect(version.pid).toBe(process.pid);
    expect(Date.parse(version.startedAt)).not.toBeNaN();
  });

  it('is refused once a source file changes after start, and accepted after a restart', async () => {
    sandbox ??= await start();
    const control = sandbox.urls.control;
    expect(
      stalenessProblem(control, await served(sandbox), sourceStamp(copy)),
    ).toBeNull();

    appendFileSync(
      join(copy, EDITED),
      '\n// edited after the sandbox started\n',
    );

    const problem = stalenessProblem(
      control,
      await served(sandbox),
      sourceStamp(copy),
    );
    expect(problem).toContain(`The vendor sandbox on ${control} was started`);
    expect(problem).toContain(`(1 file: ${EDITED})`);
    expect(problem).toContain(
      `Restart the sandbox from this worktree: stop the one on ${control} (pid ${process.pid}, started from ${copy})`,
    );
    expect(problem).toContain(
      `cd ${copy}/apps/vendor-sandbox && SANDBOX_PORT_BASE=${new URL(control).port} pnpm start`,
    );

    await sandbox.close();
    sandbox = await start();

    expect(
      stalenessProblem(control, await served(sandbox), sourceStamp(copy)),
    ).toBeNull();
  });
});

describe('stalenessProblem', () => {
  const local = {
    digest: 'b',
    files: { 'x.ts': '2', 'y.ts': '1' },
    root: '/w',
  };
  const control = 'http://127.0.0.1:4400';

  it('refuses a sandbox with no version route: it predates the route', () => {
    expect(stalenessProblem(control, null, local)).toBe(
      'The vendor sandbox on http://127.0.0.1:4400 has no /__sandbox/version, so it was started from source older than this tree. Restart the sandbox from this worktree: stop the one on http://127.0.0.1:4400; then: cd /w/apps/vendor-sandbox && SANDBOX_PORT_BASE=4400 pnpm start.',
    );
  });

  it('names changed, added and removed files, ten at most', () => {
    const served: SandboxVersion = {
      digest: 'a',
      files: { 'x.ts': '1', 'z.ts': '1', 'y.ts': '1' },
      root: '/main',
      pid: 7,
      startedAt: '2026-10-02T01:00:00.000Z',
    };
    expect(stalenessProblem(control, served, local)).toContain(
      '(2 files: x.ts, z.ts)',
    );

    const many = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [
        `f${String(i).padStart(2, '0')}.ts`,
        '1',
      ]),
    );
    expect(
      stalenessProblem(control, { ...served, files: many }, local),
    ).toContain('f09.ts, and 4 more)');
  });

  it('accepts equal digests', () => {
    expect(
      stalenessProblem(
        control,
        { ...local, pid: 1, startedAt: '2026-10-02T01:00:00.000Z' },
        local,
      ),
    ).toBeNull();
  });
});
