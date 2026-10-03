import http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { AnthropicClient } from '../src/providers/anthropic';
import { GeminiClient } from '../src/providers/gemini';
import { OpenAIClient } from '../src/providers/openai';

/**
 * FILM-1805 Half A. The openai, @anthropic-ai/sdk and @google/genai SDKs
 * each read a base-URL variable of their own (OPENAI_BASE_URL,
 * ANTHROPIC_BASE_URL, GOOGLE_GEMINI_BASE_URL / GOOGLE_VERTEX_BASE_URL) when
 * constructed without a base URL, which redirected LLM traffic - and the key
 * travelling with it - with none of FILM-1801's gate (KB-21).
 *
 * Every client is now built with a base URL from vendorUrl(). This drives
 * the real SDKs through our own providers and watches where each request
 * goes:
 *
 * - under production settings with the SDK's variable pointing at a local
 *   listener, nothing reaches the listener and the request is addressed to
 *   the vendor's host;
 * - with the sandbox on and VENDOR_URL_* set, the request reaches the
 *   listener, which is what FILM-1803's sandbox relies on.
 *
 * No request leaves the machine: anything not addressed to loopback is
 * recorded and refused before a socket opens. openai and @anthropic-ai/sdk
 * send through node-fetch (http/https.request), @google/genai through the
 * global fetch, so both layers are watched.
 */

const requestsAtListener: string[] = [];
const refusedHosts: string[] = [];
let listener: http.Server;
let origin = '';

const isLoopback = (host: string) =>
  host === '127.0.0.1' || host === 'localhost' || host === '[::1]';

function hostOf(target: unknown): string {
  if (typeof target === 'string') return new URL(target).hostname;
  if (target instanceof URL) return target.hostname;
  if (target && typeof target === 'object') {
    const options = target as {
      hostname?: string;
      host?: string;
      url?: string;
    };
    if (options.url) return new URL(options.url).hostname;
    return (options.hostname ?? options.host ?? '').replace(/:\d+$/, '');
  }
  return '';
}

beforeAll(async () => {
  listener = http.createServer((req, res) => {
    requestsAtListener.push(`${req.method} ${req.url}`);
    req.resume();
    req.on('end', () => {
      // 400 is final for every SDK here: no retry muddies the count.
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'sandbox probe', type: 'invalid_request_error' },
        }),
      );
    });
  });
  await new Promise<void>((done) => listener.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;

  for (const module of [http, https]) {
    const original = module.request.bind(module);
    vi.spyOn(module, 'request').mockImplementation(((...args: unknown[]) => {
      const host = hostOf(args[0]);
      if (!isLoopback(host)) {
        refusedHosts.push(host);
        throw new Error(`refused non-loopback request to ${host}`);
      }
      return (original as (...a: unknown[]) => http.ClientRequest)(...args);
    }) as typeof module.request);
  }

  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const host = hostOf(input);
    if (!isLoopback(host)) {
      refusedHosts.push(host);
      return Promise.reject(
        new TypeError(`refused non-loopback request to ${host}`),
      );
    }
    return realFetch(input, init);
  });
});

afterAll(async () => {
  vi.restoreAllMocks();
  await new Promise((done) => listener.close(done));
});

afterEach(() => {
  vi.unstubAllEnvs();
  requestsAtListener.length = 0;
  refusedHosts.length = 0;
});

const PRODUCTION = {
  NODE_ENV: 'production',
  VENDOR_SANDBOX: '',
  AWS_LAMBDA_FUNCTION_NAME: '',
};
const SANDBOX = {
  NODE_ENV: 'test',
  VENDOR_SANDBOX: '1',
  AWS_LAMBDA_FUNCTION_NAME: '',
};

function stub(env: Record<string, string>) {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
}

const messages = [{ role: 'user' as const, content: 'hello' }];

interface Case {
  name: string;
  sdkVariable: string;
  sdkValue: () => string;
  override: string;
  overrideValue: () => string;
  vendorHost: string;
  call: () => Promise<unknown>;
}

const CASES: Case[] = [
  {
    name: 'OpenAI chat',
    sdkVariable: 'OPENAI_BASE_URL',
    sdkValue: () => `${origin}/v1`,
    override: 'VENDOR_URL_OPENAI',
    overrideValue: () => origin,
    vendorHost: 'api.openai.com',
    call: () =>
      new OpenAIClient({
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: 'probe',
      }).createChatCompletion({ messages }),
  },
  {
    name: 'Anthropic messages',
    sdkVariable: 'ANTHROPIC_BASE_URL',
    sdkValue: () => origin,
    override: 'VENDOR_URL_ANTHROPIC',
    overrideValue: () => origin,
    vendorHost: 'api.anthropic.com',
    call: () =>
      new AnthropicClient({
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        apiKey: 'probe',
      }).createChatCompletion({
        messages,
      }),
  },
  {
    name: 'Gemini developer API',
    sdkVariable: 'GOOGLE_GEMINI_BASE_URL',
    sdkValue: () => origin,
    override: 'VENDOR_URL_GEMINI',
    overrideValue: () => origin,
    vendorHost: 'generativelanguage.googleapis.com',
    call: () =>
      new GeminiClient({
        provider: 'gemini',
        model: 'gemini-3.5-flash',
        apiKey: 'probe',
      }).createChatCompletion({
        messages,
      }),
  },
  {
    name: 'Gemini through Vertex AI Express',
    sdkVariable: 'GOOGLE_VERTEX_BASE_URL',
    sdkValue: () => origin,
    override: 'VENDOR_URL_GEMINI_VERTEX',
    overrideValue: () => origin,
    vendorHost: 'aiplatform.googleapis.com',
    call: () =>
      new GeminiClient({
        provider: 'gemini',
        model: 'gemini-3.5-flash',
        apiKey: 'probe',
        vertexai: true,
      }).createChatCompletion({ messages }),
  },
];

describe.each(CASES)('$name', (sdk) => {
  it(
    `ignores ${sdk.sdkVariable} under production settings`,
    { timeout: 20_000 },
    async () => {
      stub({ ...PRODUCTION, [sdk.sdkVariable]: sdk.sdkValue() });

      await expect(sdk.call()).rejects.toBeDefined();

      expect(requestsAtListener).toEqual([]);
      expect(refusedHosts.length).toBeGreaterThan(0);
      expect(new Set(refusedHosts)).toEqual(new Set([sdk.vendorHost]));
    },
  );

  it(
    `reaches a local stand-in through ${sdk.override} with the sandbox on`,
    { timeout: 20_000 },
    async () => {
      stub({ ...SANDBOX, [sdk.override]: sdk.overrideValue() });

      await expect(sdk.call()).rejects.toBeDefined();

      expect(refusedHosts).toEqual([]);
      expect(requestsAtListener).toHaveLength(1);
    },
  );
});
