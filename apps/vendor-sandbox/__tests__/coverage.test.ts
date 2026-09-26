import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { PROMPTS_DIR, loadCatalog } from '../src/llm/prompts';
import { generatorKindOf } from '../src/llm/respond';
import { type Sandbox, startSandbox } from './helpers';

/**
 * FILM-1803: "A new prompt file added without a generator fails a sandbox
 * test, not a demo", and "An unrecognised prompt is answered and logged as
 * unrecognised, never silently".
 */

function promptFilesOnDisk(dir = PROMPTS_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? promptFilesOnDisk(join(dir, entry.name))
      : entry.name.endsWith('.json')
        ? [entry.name]
        : [],
  );
}

describe('every prompt has a generator', () => {
  const catalog = loadCatalog();

  it('reads every prompt file there is', () => {
    expect(promptFilesOnDisk().length).toBeGreaterThanOrEqual(29);
    expect(catalog).toHaveLength(promptFilesOnDisk().length);
  });

  it('names the prompts with none', () => {
    const missing = catalog
      .filter((p) => generatorKindOf(p) === null)
      .map((p) => `${p.key} (${p.file})`);
    expect(
      missing,
      'add a template in src/llm/generate/templates.ts, or give the prompt a schema',
    ).toEqual([]);
  });

  it('generates the machine-readable kinds from the prompt, not by hand', () => {
    const counts = { zod: 0, 'json-schema': 0, template: 0 };
    for (const prompt of catalog) counts[generatorKindOf(prompt)!] += 1;

    // FILM-1803 §2: 16 Zod, 4 JSON Schema, and 9 with neither.
    expect(counts).toEqual({ zod: 16, 'json-schema': 4, template: 9 });
  });
});

describe('an unrecognised prompt', () => {
  let sandbox: Sandbox;

  beforeAll(async () => {
    sandbox = await startSandbox();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await sandbox.close();
  });

  it('is answered, flagged in the ledger and logged loudly', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const response = await fetch(
      `${sandbox.urls.gemini}/v1beta/models/gemini-3.5-flash:generateContent`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': 'sandbox-local-key',
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: 'You are a brand-new prompt nobody wrote a generator for.',
              },
            ],
          },
          contents: [{ role: 'user', parts: [{ text: 'Say something.' }] }],
        }),
      },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    expect(body.candidates[0]?.content.parts[0]?.text).toBe('{}');

    expect(sandbox.state.ledger.list()[0]?.identified).toEqual({
      kind: 'unrecognised',
    });
    expect(sandbox.state.unrecognised).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('UNRECOGNISED PROMPT'),
    );

    warn.mockRestore();
  });
});
