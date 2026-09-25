import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { HOST } from '../src/http';
import { type Sandbox, startSandbox } from './helpers';

/** FILM-1802 §6's control API and ledger, and the loopback-only bind. */

let sandbox: Sandbox;

beforeAll(async () => {
  sandbox = await startSandbox(4242);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await sandbox.close();
});

const control = (path: string, init?: RequestInit) =>
  fetch(`${sandbox.urls.control}${path}`, init);

async function callGemini(key = 'sandbox-local-key') {
  return fetch(`${sandbox.urls.gemini}/v1beta/models?key=${key}`);
}

describe('binding', () => {
  it('listens on loopback only, on every port', () => {
    for (const server of Object.values(sandbox.servers)) {
      expect((server.address() as AddressInfo).address).toBe(HOST);
    }
    expect(HOST).toBe('127.0.0.1');
  });
});

describe('ledger', () => {
  it('lists calls newest first, by vendor and after an id', async () => {
    await callGemini();
    await callGemini('sandbox-invalid-key');

    const all = (await (await control('/__sandbox/ledger')).json()) as {
      seed: number;
      entries: Array<{ id: number; status: number; vendor: string }>;
    };
    expect(all.seed).toBe(4242);
    expect(all.entries.map((e) => e.status)).toEqual([400, 200]);

    const since = (await (
      await control(`/__sandbox/ledger?since=${all.entries[1]!.id}`)
    ).json()) as {
      entries: unknown[];
    };
    expect(since.entries).toHaveLength(1);

    const other = (await (
      await control('/__sandbox/ledger?vendor=elevenlabs')
    ).json()) as { entries: unknown[] };
    expect(other.entries).toEqual([]);
  });

  it('shows the seed and the calls on the status page', async () => {
    const html = await (await control('/__sandbox')).text();
    expect(html).toContain('SANDBOX_SEED=4242');
    expect(html).toContain('/v1beta/models');
  });
});

describe('fail', () => {
  it('fails exactly the next n calls with the named status', async () => {
    const set = await control('/__sandbox/fail', {
      method: 'POST',
      body: JSON.stringify({ vendor: 'gemini', status: 503, count: 2 }),
    });
    expect(set.status).toBe(200);

    expect((await callGemini()).status).toBe(503);
    expect((await callGemini()).status).toBe(503);
    expect((await callGemini()).status).toBe(200);
  });

  it('refuses a malformed rule', async () => {
    const bad = await control('/__sandbox/fail', {
      method: 'POST',
      body: JSON.stringify({ status: 500 }),
    });
    expect(bad.status).toBe(400);
  });
});

describe('reset', () => {
  it('empties the ledger and takes a new seed', async () => {
    await callGemini();
    const reset = (await (
      await control('/__sandbox/reset', {
        method: 'POST',
        body: JSON.stringify({ seed: 7 }),
      })
    ).json()) as {
      seed: number;
    };
    expect(reset.seed).toBe(7);

    const state = (await (await control('/__sandbox/state')).json()) as {
      seed: number;
      ledgerSize: number;
    };
    expect(state).toMatchObject({ seed: 7, ledgerSize: 0 });
  });
});
