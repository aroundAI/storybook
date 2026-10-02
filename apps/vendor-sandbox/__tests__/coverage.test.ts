import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ORCHESTRATOR_SCRIPTS } from '../src/llm/agents/scripts';
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

    // FILM-1803 §2: 16 Zod, 4 JSON Schema and 9 with neither, plus the two
    // evaluation prompts KB-116 added (Zod), less the LinkedIn post prompt
    // (JSON Schema) retired with LinkedIn (FILM-717).
    expect(counts).toEqual({ zod: 18, 'json-schema': 3, template: 9 });
  });
});

/**
 * Every agent the app runs must be one the sandbox can drive. The names are
 * read from the `runAgent` call sites, not restated. Two have no caller at
 * all and are listed with the evidence.
 */
const UNREACHABLE_AGENTS: Record<string, string> = {
  'content-orchestrator':
    'runContentOrchestrator (packages/features/episodes/src/agent/orchestrator.ts) has no caller',
  'story-generator':
    'runAgentStoryGeneration (packages/features/episodes/src/server/agent-story-generation.ts) has no caller',
};

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === '__tests__') return [];
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.ts$/.test(entry.name) && !entry.name.endsWith('.test.ts')
      ? [full]
      : [];
  });
}

describe('every agent has a script', () => {
  const REPO = join(PROMPTS_DIR, '../../../../..');
  const agents = sources(join(REPO, 'packages/features')).flatMap((file) =>
    [
      ...readFileSync(file, 'utf8').matchAll(
        /runAgent<[^>]*>\(\s*\{\s*name: '([^']+)'/g,
      ),
    ].map((m) => m[1]!),
  );

  it('finds the runAgent call sites', () => {
    expect(agents.length).toBeGreaterThanOrEqual(9);
  });

  it('names the agents with neither a script nor a reason', () => {
    const scripted = new Set(ORCHESTRATOR_SCRIPTS.map((s) => s.name));
    const missing = agents.filter(
      (name) => !scripted.has(name) && !(name in UNREACHABLE_AGENTS),
    );
    expect(missing, 'add a script in src/llm/agents/scripts.ts').toEqual([]);
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

  it('includes an agent the sandbox has no script for', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const systemPrompt = [
      'You are the Weather Pipeline Director.',
      '',
      '# Available Tools',
      '',
      '- **forecast**: Forecasts the weather',
      '',
      '# Response Format',
      '',
      '{ "action": "tool_call", "tool": "<tool_name>" }',
    ].join('\n');

    await fetch(
      `${sandbox.urls.gemini}/v1beta/models/gemini-3.5-flash:generateContent`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': 'sandbox-local-key',
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: 'Will it rain?' }] }],
        }),
      },
    );

    expect(sandbox.state.ledger.list()[0]?.identified).toEqual({
      kind: 'unrecognised',
    });
    warn.mockRestore();
  });
});
