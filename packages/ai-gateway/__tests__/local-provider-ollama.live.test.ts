import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { PROMPT_REGISTRY } from '../src/lib/server/prompt-registry';

// FILM-1805 Half B, the live run. The real story-ideation prompt through the
// real executeLLM and LocalClient against a running Ollama, with §4.4's
// environment. Skipped unless OLLAMA_LIVE=1, so CI never needs a model:
//
//   ollama pull llama3.1 && ollama serve
//   OLLAMA_LIVE=1 pnpm --filter @kit/prompt-engine exec vitest run local-provider-ollama
//
// The outgoing request is captured at http.request (the openai SDK's
// node-fetch calls it by property), so the host, path and body asserted
// below are what went over the wire.

vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@kit/supabase/lambda-admin-client', () => ({
  createLambdaAdminClient: () => null,
}));

const { executeLLM } = await import('../src/lib/server/llm-executor');

const model = process.env.OLLAMA_MODEL ?? 'llama3.1';
const ideation = PROMPT_REGISTRY['story-ideation']!;

interface CapturedRequest {
  host: string;
  path: string;
  body: string;
}

const captured: CapturedRequest[] = [];

beforeEach(() => {
  captured.length = 0;
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('VENDOR_SANDBOX', '1');
  vi.stubEnv('LLM_FORCE_PROVIDER', 'local');
  vi.stubEnv('LLM_MODEL', model);
  // Unset, so the provider's own default (Ollama's port) is what is proved.
  vi.stubEnv('LOCAL_API_URL', undefined);

  const request = http.request;

  vi.spyOn(http, 'request').mockImplementation(((
    ...args: Parameters<typeof http.request>
  ) => {
    const req = request(...args);
    const entry: CapturedRequest = {
      host: String(req.getHeader('host') ?? req.host),
      path: req.path,
      body: '',
    };
    const write = req.write.bind(req);

    req.write = ((chunk: unknown, ...rest: unknown[]) => {
      entry.body += String(chunk);
      return (write as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof req.write;
    captured.push(entry);

    return req;
  }) as typeof http.request);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe.skipIf(process.env.OLLAMA_LIVE !== '1')(
  'story-ideation on a real local model through Ollama (FILM-1805)',
  () => {
    it('reaches localhost:11434 and returns ideas the prompt schema accepts', async () => {
      expect(ideation.llm.provider).toBe('gemini');

      const result = await executeLLM<{ ideas: unknown[] }>({
        templateSlug: 'story-ideation',
        variables: {
          ...Object.fromEntries(
            Object.keys(ideation.variables).map((name) => [name, '']),
          ),
          premise:
            'A lighthouse keeper on a remote island starts hearing the sea speak in her late mother’s voice',
          number_of_ideas: 3,
          genre: 'drama',
          target_audience: 'adult',
          visual_style: 'cinematic',
        },
        context: { name: 'film-1805-ollama-live', accountId: 'acct-1805' },
        validateSchema: true,
      });

      const completions = captured.filter((c) =>
        c.path.endsWith('/chat/completions'),
      );

      expect(completions.length).toBeGreaterThanOrEqual(1);

      const [first] = completions;
      const sent = JSON.parse(first!.body) as {
        model: string;
        messages: { content: string }[];
        response_format?: unknown;
      };

      expect(first!.host).toBe('localhost:11434');
      expect(first!.path).toBe('/v1/chat/completions');
      expect(sent.model).toBe(model);
      expect(sent.messages.at(-1)?.content).toContain('lighthouse keeper');

      expect(result.metadata).toMatchObject({ provider: 'local', model });

      // Re-check independently of the executor: the prompt's own Zod
      // definition, compiled the way the executor compiles it.
      const schema = new Function(
        'z',
        `return ${ideation.output!.schema!.definition}`,
      )(z) as z.ZodTypeAny;
      const parsed = schema.safeParse(result.data);

      console.info(
        JSON.stringify(
          {
            request: {
              host: first!.host,
              path: first!.path,
              model: sent.model,
              response_format: sent.response_format ?? null,
              attempts: completions.length,
            },
            metadata: result.metadata,
            schemaValid: parsed.success,
            ideas: result.data,
          },
          null,
          2,
        ),
      );

      expect(parsed.success).toBe(true);
    }, 600_000);
  },
);
