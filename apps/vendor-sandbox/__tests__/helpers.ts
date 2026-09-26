import { vi } from 'vitest';

import { corpus } from '../src/corpus';
import { type Sandbox, createSandbox } from '../src/sandbox';

/** A sandbox on free ports, and the environment the app would run with. */
export async function startSandbox(seed = 1803) {
  const sandbox = await createSandbox({
    seed,
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
  vi.stubEnv('VENDOR_URL_GEMINI', sandbox.urls.gemini);
  vi.stubEnv('VENDOR_URL_OPENAI', sandbox.urls.openai);
  vi.stubEnv('VENDOR_URL_ELEVENLABS', sandbox.urls.elevenlabs);
  vi.stubEnv('GEMINI_API_KEY', 'sandbox-local-key');
  vi.stubEnv('GEMINI_VERTEXAI', '');

  return sandbox;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/**
 * Refuses, and records, any fetch that would leave this machine. The app's
 * clients reach the sandbox by `fetch`; if a redirect ever failed, the call
 * would head for the real vendor, and this is where that shows.
 */
export function guardEgress() {
  const refused: string[] = [];
  const realFetch = globalThis.fetch;

  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const host = new URL(url).hostname;
    if (!LOOPBACK.has(host)) {
      refused.push(host);
      return Promise.reject(new TypeError(`egress refused: ${host}`));
    }
    return realFetch(input, init);
  });

  return refused;
}

/** Realistic values for a prompt's variables, by name. */
export function variablesFor(names: readonly string[]) {
  return Object.fromEntries(
    names.map((name, i) => {
      const lower = name.toLowerCase();
      if (/number_of|count|num_|^n_/.test(lower)) return [name, 3];
      if (/duration|seconds|runtime/.test(lower)) return [name, 180];
      if (/act_number|episode_number|season_number/.test(lower))
        return [name, 2];
      if (/language/.test(lower)) return [name, 'Spanish'];
      if (/dialogue_lines/.test(lower)) {
        return [
          name,
          corpus.dialogue
            .slice(0, 4)
            .map((line, n) => `${n + 1}. ${line}`)
            .join('\n'),
        ];
      }
      return [
        name,
        corpus.loglineTemplates[i % corpus.loglineTemplates.length]!.replaceAll(
          '{a}',
          'Mara',
        )
          .replaceAll('{b}', 'Theo')
          .replaceAll('{loc}', 'the lighthouse on Gull Point'),
      ];
    }),
  );
}

export type { Sandbox };
