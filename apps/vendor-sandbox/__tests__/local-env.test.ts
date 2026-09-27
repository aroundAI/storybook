import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * FILM-1803: local-env.sh adds the sandbox block to local.env exactly once,
 * and the egress guard used for live runs refuses anything that would leave
 * the machine while letting loopback through.
 */

const REPO = resolve(__dirname, '../../..');
const LIB = join(REPO, 'scripts/lib/vendor-sandbox.sh');
const GUARD = join(REPO, 'apps/vendor-sandbox/scripts/egress-guard.mjs');

function ensureTwice(initial: string) {
  const file = join(mkdtempSync(join(tmpdir(), 'sandbox-env-')), 'local.env');
  writeFileSync(file, initial);
  for (let i = 0; i < 2; i++) {
    const run = spawnSync('bash', [
      '-c',
      `. "${LIB}" && ensure_sandbox_env "${file}"`,
    ]);
    expect(run.status, run.stderr.toString()).toBe(0);
  }
  return readFileSync(file, 'utf8');
}

describe('the local.env block', () => {
  it('is added once to an existing file, which keeps its own lines', () => {
    const env = ensureTwice('NODE_ENV=development\nCLICKHOUSE_ENABLED=true\n');

    expect(
      env.startsWith('NODE_ENV=development\nCLICKHOUSE_ENABLED=true\n'),
    ).toBe(true);
    expect(env.match(/# >>> vendor-sandbox/g)).toHaveLength(1);
    expect(env).toContain('VENDOR_SANDBOX=1\n');
    expect(env).toContain('VENDOR_URL_GEMINI=http://127.0.0.1:4112\n');
    expect(env).toContain('VENDOR_URL_ELEVENLABS=http://127.0.0.1:4113\n');
    expect(env).toContain('VENDOR_URL_OPENAI=http://127.0.0.1:4110\n');
  });

  it('rewrites the block on every run, keeping lines outside it', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'sandbox-env-')), 'local.env');
    writeFileSync(
      file,
      'NODE_ENV=development\n# >>> vendor-sandbox (FILM-1803)\nVENDOR_URL_GEMINI=http://127.0.0.1:9999\nSTALE=1\n# <<< vendor-sandbox\nAFTER=kept\n',
    );
    const run = spawnSync('bash', [
      '-c',
      `. "${LIB}" && ensure_sandbox_env "${file}"`,
    ]);
    expect(run.status, run.stderr.toString()).toBe(0);
    const env = readFileSync(file, 'utf8');
    expect(env).not.toContain('STALE=1');
    expect(env).not.toContain('9999');
    expect(env).toContain('AFTER=kept');
    expect(env).toContain('VENDOR_URL_GEMINI=http://127.0.0.1:4112');
  });

  it('adds a machine-local encryption key only when the file has none', () => {
    const fresh = ensureTwice('NODE_ENV=development\n');
    const key = /^ENCRYPTION_KEY=(.+)$/m.exec(fresh)?.[1];
    expect(Buffer.from(key!, 'base64')).toHaveLength(32);

    const kept = ensureTwice('ENCRYPTION_KEY=already-here\n');
    expect(kept.match(/^ENCRYPTION_KEY=/gm)).toHaveLength(1);
    expect(kept).toContain('ENCRYPTION_KEY=already-here');
  });

  it('names only loopback addresses and a placeholder key', () => {
    const block = ensureTwice('').split('# >>> vendor-sandbox')[1]!;
    for (const url of block.match(/https?:\/\/[^\s]+/g) ?? []) {
      expect(new URL(url).hostname).toBe('127.0.0.1');
    }
    expect(block).toMatch(/GEMINI_API_KEY=sandbox-local-key/);
  });
});

describe('starting and stopping the sandbox', () => {
  it(
    'returns promptly even when its output is piped, and stops the process it started',
    { timeout: 90_000 },
    () => {
      const root = mkdtempSync(join(tmpdir(), 'sandbox-root-'));
      spawnSync('mkdir', ['-p', join(root, 'apps')]);
      spawnSync('ln', [
        '-s',
        join(REPO, 'apps/vendor-sandbox'),
        join(root, 'apps/vendor-sandbox'),
      ]);
      const base = 47_000 + Math.floor(Math.random() * 900) * 20;
      const env = { ...process.env, SANDBOX_PORT_BASE: String(base) };

      try {
        // Piped through cat, as `local-env.sh up | tee log` would be: a
        // background job holding the pipe makes this time out.
        const started = spawnSync(
          'bash',
          ['-c', `. "${LIB}" && start_sandbox "${root}" | cat`],
          { env, timeout: 60_000 },
        );
        expect(
          started.error,
          'start_sandbox did not return while its output was piped',
        ).toBeUndefined();
        expect(started.stdout.toString()).toMatch(/\[sandbox\] seed \d+/);

        const pid = Number(readFileSync(join(root, '.sandbox/pid'), 'utf8'));
        expect(
          spawnSync('ps', [
            '-p',
            String(pid),
            '-o',
            'command=',
          ]).stdout.toString(),
        ).toMatch(/tsx/);

        spawnSync('bash', ['-c', `. "${LIB}" && stop_sandbox "${root}"`], {
          env,
        });
        spawnSync('sleep', ['1']);
        expect(spawnSync('kill', ['-0', String(pid)]).status).not.toBe(0);
      } finally {
        // A run that fails (or a guard's mutation of stop) must not leave a
        // sandbox on the grid for a later run's random base to land on
        spawnSync('bash', [
          '-c',
          `lsof -ti tcp:${base} -sTCP:LISTEN | xargs kill 2>/dev/null; true`,
        ]);
      }
    },
  );

  // A sandbox left running by another checkout answered for this one: the
  // start was reported with no seed and the pid of a process that had died.
  it('refuses to start when something else already answers on its port', async () => {
    const other = http.createServer((_req, res) => res.end('{}'));
    await new Promise<void>((done) => other.listen(0, '127.0.0.1', done));
    const base = (other.address() as AddressInfo).port;
    const root = mkdtempSync(join(tmpdir(), 'sandbox-root-'));
    spawnSync('mkdir', ['-p', join(root, 'apps')]);
    spawnSync('ln', [
      '-s',
      join(REPO, 'apps/vendor-sandbox'),
      join(root, 'apps/vendor-sandbox'),
    ]);

    const started = await new Promise<{ status: number | null; out: string }>(
      (done) => {
        const child = spawn(
          'bash',
          ['-c', `. "${LIB}" && start_sandbox "${root}"`],
          { env: { ...process.env, SANDBOX_PORT_BASE: String(base) } },
        );
        let out = '';
        child.stdout.on('data', (d) => (out += d));
        child.on('close', (status) => done({ status, out }));
      },
    );
    other.close();

    expect(started.status).not.toBe(0);
    expect(started.out).toMatch(/already answers on http:\/\/127\.0\.0\.1:\d+/);
    expect(existsSync(join(root, '.sandbox/pid'))).toBe(false);
  });
});

describe('the egress guard', () => {
  it('refuses a public host and lets loopback through', async () => {
    const server = http.createServer((_req, res) => res.end('local ok'));
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const port = (server.address() as AddressInfo).port;
    const log = join(mkdtempSync(join(tmpdir(), 'egress-')), 'blocked.log');

    const script = `
      const local = await fetch('http://127.0.0.1:${port}/').then((r) => r.text());
      let remote = 'reached';
      // TEST-NET-1: reserved, never routed - nothing real is ever contacted,
      // whether or not the guard works. The log is what tells them apart.
      try { await fetch('https://192.0.2.1/v1/models', { signal: AbortSignal.timeout(2000) }); } catch (e) { remote = 'refused'; }
      console.log(JSON.stringify({ local, remote }));
    `;
    const run = await new Promise<{ out: string; err: string }>((done) => {
      const child = spawn(
        process.execPath,
        ['--import', GUARD, '--input-type=module', '-e', script],
        {
          env: { ...process.env, EGRESS_GUARD_LOG: log },
        },
      );
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('close', () => done({ out, err }));
    });
    server.close();

    expect(JSON.parse(run.out.trim()), run.err).toEqual({
      local: 'local ok',
      remote: 'refused',
    });
    expect(readFileSync(log, 'utf8')).toMatch(
      /egress refused: 192\.0\.2\.1:443/,
    );
  });
});
