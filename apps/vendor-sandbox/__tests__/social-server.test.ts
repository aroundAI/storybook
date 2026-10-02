import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { HOST } from '../src/http';
import {
  SOCIAL_ORIGINS,
  redactSecrets,
  socialHandler,
} from '../src/social/server';
import { type Sandbox, startSandbox } from './helpers';

/**
 * FILM-1802 PR A: the five social origins exist, bind loopback, record every
 * call in the ledger (by object too), and never record a credential.
 */

let sandbox: Sandbox;

beforeAll(async () => {
  sandbox = await startSandbox(1802);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await sandbox.close();
});

const control = (path: string, init?: RequestInit) =>
  fetch(`${sandbox.urls.control}${path}`, init);

describe('origins', () => {
  it('one origin per platform, each on loopback', () => {
    for (const origin of Object.keys(SOCIAL_ORIGINS) as Array<
      keyof typeof SOCIAL_ORIGINS
    >) {
      const server = sandbox.servers[origin];
      expect(server, origin).toBeDefined();
      expect((server.address() as AddressInfo).address).toBe(HOST);
    }
  });

  it('the default ports are 4101–4104, clear of the AI vendors', async () => {
    const { DEFAULT_PORTS } = await import('../src/sandbox');
    expect([
      DEFAULT_PORTS.meta,
      DEFAULT_PORTS.tiktok,
      DEFAULT_PORTS.google,
      DEFAULT_PORTS.x,
    ]).toEqual([4101, 4102, 4103, 4104]);
    expect(new Set(Object.values(DEFAULT_PORTS)).size).toBe(
      Object.keys(DEFAULT_PORTS).length,
    );
  });

  it('a path nothing serves yet is a 404 that shows in the ledger, not silence', async () => {
    const response = await fetch(
      `${sandbox.urls.tiktok}/v2/research/video/query/?fields=id`,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer sbx.tiktok.abc' },
      },
    );
    expect(response.status).toBe(404);

    const { entries } = (await (
      await control('/__sandbox/ledger?vendor=tiktok')
    ).json()) as {
      entries: Array<{
        vendor: string;
        path: string;
        status: number;
        keyPresent: boolean;
      }>;
    };
    expect(entries[0]).toMatchObject({
      vendor: 'tiktok',
      path: '/v2/research/video/query/',
      status: 404,
      keyPresent: true,
    });
  });
});

describe('ledger', () => {
  it('filters by object', async () => {
    const handler = socialHandler('google', sandbox.state, sandbox.social, [
      ({ url, res, about }) => {
        const id = url.searchParams.get('id');
        if (!id) return false;
        about(id);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"kind":"youtube#videoListResponse"}');
        return true;
      },
    ]);
    const call = (id: string) =>
      new Promise<void>((resolve) => {
        const res = {
          statusCode: 200,
          headersSent: false,
          writeHead() {},
          end() {
            resolve();
          },
        };
        void handler(
          {
            url: `/youtube/v3/videos?id=${id}`,
            method: 'GET',
            headers: {},
          } as never,
          res as never,
          Buffer.alloc(0),
        );
      });

    await call('dQw4w9WgXcQ');
    await call('a1B2c3D4e5F');

    const { entries } = (await (
      await control('/__sandbox/ledger?object=dQw4w9WgXcQ')
    ).json()) as { entries: Array<{ object?: string; vendor: string }> };
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.object === 'dQw4w9WgXcQ')).toBe(true);
  });

  it('records the query string, so a test can see which metrics and breakdown were asked for, without the token', async () => {
    await fetch(
      `${sandbox.urls.meta}/v19.0/17900000000000001/insights?metric=reach&breakdown=follow_type&access_token=kept-out-of-the-ledger`,
    );
    const { entries } = (await (
      await control('/__sandbox/ledger?vendor=meta')
    ).json()) as { entries: Array<{ path: string; query?: string }> };
    const entry = entries.find((e) => e.path.endsWith('/insights'));
    expect(entry?.query).toContain('breakdown=follow_type');
    expect(entry?.query).toContain('metric=reach');
    expect(entry?.query).not.toContain('kept-out-of-the-ledger');
  });

  it('a token request sent to an origin is in the ledger without its secrets', async () => {
    await fetch(`${sandbox.urls.tiktok}/v2/oauth/token/`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'client_key=sandboxtiktokclientkey&client_secret=kept-out-of-the-ledger&code=one-time-code&grant_type=authorization_code',
    });
    const { entries } = (await (
      await control('/__sandbox/ledger?vendor=tiktok')
    ).json()) as { entries: Array<{ path: string; requestSummary?: string }> };
    const entry = entries.find((e) => e.path === '/v2/oauth/token/');
    expect(entry?.requestSummary).toContain('grant_type=authorization_code');
    expect(entry?.requestSummary).not.toMatch(
      /kept-out-of-the-ledger|one-time-code/,
    );
  });

  it('never records a credential, in a form body, JSON or a query', () => {
    const form = redactSecrets(
      'grant_type=authorization_code&code=4/0AbCd&client_secret=s3cret&redirect_uri=http%3A%2F%2Flocalhost',
    );
    expect(form).not.toMatch(/4\/0AbCd|s3cret/);
    expect(form).toContain('grant_type=authorization_code');
    expect(form).toContain('code=[redacted]');

    const json = redactSecrets(
      '{"access_token":"sbx.youtube.xyz","refresh_token":"sbx.youtube.r.abc","expires_in":3599,"scope":"a b"}',
    );
    expect(json).not.toMatch(/sbx\.youtube/);
    expect(json).toContain('"expires_in":3599');

    expect(redactSecrets('?fb_exchange_token=EAAB&fields=id')).toBe(
      '?fb_exchange_token=[redacted]&fields=id',
    );
  });
});

describe('control', () => {
  it('/__sandbox/state includes the social run', async () => {
    const account = sandbox.social.createAccount('youtube');
    const body = (await (await control('/__sandbox/state')).json()) as {
      social: { seed: number; accounts: Array<{ id: string }> };
    };
    expect(body.social.seed).toBe(sandbox.social.seed);
    expect(body.social.accounts.map((a) => a.id)).toContain(account.id);
  });

  it('a reset starts the social run over under the new seed', async () => {
    sandbox.social.createAccount('instagram');
    const response = await control('/__sandbox/reset', {
      method: 'POST',
      body: JSON.stringify({ seed: 777 }),
    });
    expect(response.status).toBe(200);
    expect(sandbox.social.seed).toBe(777);
    expect(sandbox.social.listAccounts()).toEqual([]);
  });

  it('the state never shows a whole token', async () => {
    const account = sandbox.social.createAccount('x');
    const { access } = sandbox.social.issueTokens('x', account.id, [
      'tweet.read',
    ]);
    const text = await (await control('/__sandbox/state')).text();
    expect(text).not.toContain(access.value);
  });
});
