import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { PROMPT_REGISTRY } from '../src/lib/server/prompt-registry';

// FILM-1805 Half B. A real prompt (story ideation, with its own Zod schema)
// runs through the real executeLLM and the real local provider against an
// in-process OpenAI-compatible server standing in for Ollama. The live run
// against Ollama itself is the owner's step; this proves the request shape
// and that the prompt's own schema accepts what comes back.

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

interface CapturedRequest {
  url: string;
  host: string;
  body: { model: string; messages: { role: string; content: string }[] };
}

const captured: CapturedRequest[] = [];
let stub: http.Server;
let stubUrl = '';

const ideation = PROMPT_REGISTRY['story-ideation']!;

const config = {
  templateSlug: 'story-ideation',
  variables: {
    ...Object.fromEntries(
      Object.keys(ideation.variables).map((name) => [name, `<${name}>`]),
    ),
    premise: 'A lighthouse keeper hears the sea speak',
  },
  context: { name: 'film-1805-stub', accountId: 'acct-1805' },
};

beforeAll(async () => {
  stub = http.createServer((req, res) => {
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      captured.push({
        url: req.url ?? '',
        host: req.headers.host ?? '',
        body: JSON.parse(Buffer.concat(chunks).toString()),
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'stub-1',
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: JSON.stringify(ideation.output?.example_output),
              },
            },
          ],
          usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
        }),
      );
    });
  });
  await new Promise<void>((done) => stub.listen(0, '127.0.0.1', done));
  stubUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}/v1`;
});

afterAll(() => new Promise<void>((done) => stub.close(() => done())));

beforeEach(() => {
  captured.length = 0;
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('VENDOR_SANDBOX', '1');
  vi.stubEnv('LOCAL_API_URL', stubUrl);
  vi.stubEnv('LLM_MODEL', 'llama3.1');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('a real prompt through the local provider (FILM-1805)', () => {
  it('runs story-ideation, pinned to gemini, on the local model when LLM_FORCE_PROVIDER=local', async () => {
    expect(ideation.llm.provider).toBe('gemini');
    vi.stubEnv('LLM_FORCE_PROVIDER', 'local');

    const result = await executeLLM<{ title: string }[]>({
      ...config,
      validateSchema: true,
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe('/v1/chat/completions');
    expect(captured[0]?.host).toBe(new URL(stubUrl).host);
    expect(captured[0]?.body.model).toBe('llama3.1');
    expect(captured[0]?.body.messages[1]?.content).toContain('lighthouse');
    expect(result.metadata).toMatchObject({
      provider: 'local',
      model: 'llama3.1',
    });
    expect(result.data).toEqual(ideation.output?.example_output);
  });

  it('a prompt whose file says local reaches LOCAL_API_URL, not the default port', async () => {
    const registryEntry = PROMPT_REGISTRY['story-ideation']!;
    const pinned = registryEntry.llm;

    registryEntry.llm = { ...pinned, provider: 'local', model: 'llama3.1' };

    try {
      const result = await executeLLM(config);

      expect(captured).toHaveLength(1);
      expect(captured[0]?.host).toBe(new URL(stubUrl).host);
      expect(result.metadata.provider).toBe('local');
    } finally {
      registryEntry.llm = pinned;
    }
  }, 5000);
});
