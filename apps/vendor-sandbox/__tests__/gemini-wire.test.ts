import { GoogleGenAI } from '@google/genai';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { compileZodDefinition } from '../src/llm/generate/zod';
import { SCHEMA_FOR_LLM_HEADER, loadCatalog } from '../src/llm/prompts';
import { INVALID_KEY } from '../src/vendors/gemini';
import { type Sandbox, startSandbox } from './helpers';

/**
 * The Gemini stand-in speaks the wire format the real `@google/genai` SDK
 * expects: this drives the SDK itself, not a hand-written client, so a
 * response the SDK cannot read fails here.
 */

let sandbox: Sandbox;

beforeAll(async () => {
  sandbox = await startSandbox();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await sandbox.close();
});

const client = (apiKey = 'sandbox-local-key') =>
  new GoogleGenAI({ apiKey, httpOptions: { baseUrl: sandbox.urls.gemini } });

const ideation = loadCatalog().find((p) => p.key === 'story-ideation')!;
const systemInstruction =
  ideation.template.system_prompts.map((p) => p.content).join('\n\n') +
  SCHEMA_FOR_LLM_HEADER +
  (ideation.template.output?.schema_for_llm ?? '');
const schema = compileZodDefinition(
  (ideation.template.output?.schema as { definition: string }).definition,
);

function parse(text: string) {
  const json = text.replace(/^```json\n|\n```$/g, '');
  return JSON.parse(json) as unknown;
}

describe('generateContent', () => {
  it('returns text the SDK reads, in the prompt’s own shape', async () => {
    const response = await client().models.generateContent({
      model: 'gemini-3.5-flash',
      contents:
        'Generate 3 unique story ideas based on this premise: a lighthouse that sends letters.',
      config: { systemInstruction },
    });

    const data = schema.parse(parse(response.text ?? '')) as {
      ideas: unknown[];
    };
    expect(data.ideas).toHaveLength(3);
    expect(response.usageMetadata?.totalTokenCount).toBeGreaterThan(0);
    expect(response.candidates?.[0]?.finishReason).toBe('STOP');

    const entry = sandbox.state.ledger.list()[0];
    expect(entry?.identified).toEqual({
      kind: 'prompt',
      key: 'story-ideation',
    });
    expect(entry?.keyPresent).toBe(true);
    expect(JSON.stringify(entry)).not.toContain('sandbox-local-key');
  });
});

describe('generateContentStream', () => {
  it('streams chunks that join to the served reply', async () => {
    const stream = await client().models.generateContentStream({
      model: 'gemini-3.5-flash',
      contents:
        'Generate 2 unique story ideas based on this premise: a night ferry.',
      config: { systemInstruction },
    });

    let text = '';
    let chunks = 0;
    for await (const chunk of stream) {
      text += chunk.text ?? '';
      chunks += 1;
    }

    expect(chunks).toBeGreaterThan(1);
    expect(sandbox.state.ledger.list()[0]?.responseSummary).toBe(text);
    expect(
      (schema.parse(parse(text)) as { ideas: unknown[] }).ideas,
    ).toHaveLength(2);
  });
});

describe('errors, as the vendor sends them', () => {
  it('rejects an invalid key with a 400', async () => {
    await expect(
      client(INVALID_KEY).models.generateContent({
        model: 'gemini-3.5-flash',
        contents: 'hi',
      }),
    ).rejects.toThrow(/API key not valid/);
    expect(sandbox.state.ledger.list()[0]?.status).toBe(400);
  });

  it('fails the next call as injected, then recovers', async () => {
    const injected = await fetch(`${sandbox.urls.control}/__sandbox/fail`, {
      method: 'POST',
      body: JSON.stringify({ vendor: 'gemini', status: 429, count: 1 }),
    });
    expect(injected.status).toBe(200);

    await expect(
      client().models.generateContent({
        model: 'gemini-3.5-flash',
        contents: 'hi',
        config: { systemInstruction },
      }),
    ).rejects.toThrow(/RESOURCE_EXHAUSTED|429/);
    expect(sandbox.state.ledger.list()[0]).toMatchObject({
      status: 429,
      injectedFailure: true,
    });

    const next = await client().models.generateContent({
      model: 'gemini-3.5-flash',
      contents: 'hi',
      config: { systemInstruction },
    });
    expect(next.text).toBeTruthy();
  });

  it('lists models for a key check', async () => {
    const response = await fetch(
      `${sandbox.urls.gemini}/v1beta/models?key=anything`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { models: Array<{ name: string }> };
    expect(body.models.map((m) => m.name)).toContain('models/gemini-3.5-flash');

    expect(
      (await fetch(`${sandbox.urls.gemini}/v1beta/models?key=${INVALID_KEY}`))
        .status,
    ).toBe(400);
  });
});
