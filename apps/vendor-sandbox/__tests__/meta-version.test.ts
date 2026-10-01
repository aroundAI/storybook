import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { type Sandbox, createSandbox } from '../src/sandbox';
import { servedGraphMajor } from '../src/social/vendors/meta/version';

/**
 * FILM-1728 for the Meta origin: the sandbox answers with the
 * `facebook-api-version` header as Graph does, and the app's pinned version
 * is one it serves as itself — so `metaFetch`'s served-version check runs on
 * every sandbox-backed call and stays quiet on the pin.
 */

const NOW = Date.parse('2026-10-01T09:00:00Z');

let sandbox: Sandbox;

beforeAll(async () => {
  sandbox = await createSandbox({
    seed: 1728,
    speed: 1,
    now: () => NOW,
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
  vi.stubEnv('VENDOR_SANDBOX', '1');
  vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', '');
  for (const name of ['META_GRAPH', 'META_GRAPH_VIDEO', 'META_OAUTH']) {
    vi.stubEnv(`VENDOR_URL_${name}`, sandbox.urls.meta);
  }
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await sandbox.close();
});

async function served(path: string) {
  const response = await fetch(`${sandbox.urls.meta}${path}`);
  return response.headers.get('facebook-api-version');
}

describe('the Meta sandbox names the Graph version it served (FILM-1728)', () => {
  it('reproduces the probes measured against Meta', () => {
    // 2026-09-21: v18.0 was answered as v20.0. 2026-10-01: v27.0 as v21.0.
    expect(servedGraphMajor(18, Date.parse('2026-09-21T20:00:00Z'))).toBe(20);
    expect(servedGraphMajor(27, NOW)).toBe(21);
    expect(servedGraphMajor(26, NOW)).toBe(26);
  });

  it('sends the header on a versioned Graph path, whatever the route answers', async () => {
    const version = (major: number) => `v${major}.0`;

    expect(await served(`/${version(26)}/me`)).toBe(version(26));
    // v20.0 expired 2026-09-24; the oldest usable version answers.
    expect(await served(`/${version(20)}/me`)).toBe(version(21));
  });

  it('serves the pinned version as itself, so metaFetch reports nothing', async () => {
    const { META_GRAPH_VERSION, metaFetch } = await import(
      '@kit/shared/vendors'
    );
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await metaFetch('/me', { token: 'not-a-token' });

    expect(response.headers.get('facebook-api-version')).toBe(
      META_GRAPH_VERSION,
    );
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
