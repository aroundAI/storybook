import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { type Sandbox, createSandbox } from '../src/sandbox';
import { HOURLY_INSTAGRAM_CALLS } from '../src/social/vendors/meta/usage';

/**
 * Meta's business-use-case rate limit, served: every Instagram insights
 * response carries X-Business-Use-Case-Usage, the percentage rises with the
 * hour's calls, and a call past the allowance is refused with code 80002 —
 * what the app's reach sync paces itself against.
 */

let now = Date.parse('2026-09-28T17:00:00Z');
let sandbox: Sandbox;
let token: string;
let igId: string;

beforeAll(async () => {
  sandbox = await createSandbox({
    seed: 1804,
    speed: 1,
    now: () => now,
    ports: {
      control: 0,
      openai: 0,
      gemini: 0,
      elevenlabs: 0,
      meta: 0,
      tiktok: 0,
      google: 0,
      x: 0,
      linkedin: 0,
    },
  });
  vi.stubEnv('NODE_ENV', 'test');
  const page = sandbox.social.signedIn('facebook');
  igId = sandbox.social.signedIn('instagram').id;
  // A Page token, which does not expire in the hour this test moves through.
  token = sandbox.social.issueTokens(
    'facebook',
    page.id,
    ['instagram_manage_insights'],
    {
      refresh: false,
      ttlMs: 24 * 3_600_000,
    },
  ).access.value;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await sandbox.close();
});

async function reach() {
  const end = Math.floor(now / 1000);
  const response = await fetch(
    `${sandbox.urls.meta}/v23.0/${igId}/insights?${new URLSearchParams({
      metric: 'reach',
      metric_type: 'total_value',
      period: 'day',
      since: String(end - 7 * 86_400),
      until: String(end),
      access_token: token,
    })}`,
  );
  const usage = JSON.parse(
    response.headers.get('x-business-use-case-usage')!,
  ) as Record<string, Array<{ type: string; call_count: number }>>;
  const [entry] = Object.values(usage)[0]!;
  return {
    status: response.status,
    body: await response.json(),
    usage: entry!,
  };
}

describe('Meta sandbox: the Instagram rate limit', () => {
  it('reports rising usage, then refuses with 80002 past the allowance', async () => {
    const first = await reach();
    expect(first.status).toBe(200);
    expect(first.usage.type).toBe('instagram');
    expect(first.usage.call_count).toBe(
      Math.floor(100 / HOURLY_INSTAGRAM_CALLS),
    );

    for (let i = 1; i < HOURLY_INSTAGRAM_CALLS / 2; i++) await reach();
    expect((await reach()).usage.call_count).toBe(50);

    for (
      let i = HOURLY_INSTAGRAM_CALLS / 2 + 1;
      i < HOURLY_INSTAGRAM_CALLS;
      i++
    ) {
      await reach();
    }
    const refused = await reach();
    expect(refused.status).toBe(400);
    expect((refused.body as { error: { code: number } }).error.code).toBe(
      80002,
    );
    expect(refused.usage.call_count).toBe(100);
  });

  it('the allowance comes back as the hour rolls on', async () => {
    now += 61 * 60_000;
    const after = await reach();
    expect(after.status).toBe(200);
    expect(after.usage.call_count).toBeLessThan(100);
  });
});
