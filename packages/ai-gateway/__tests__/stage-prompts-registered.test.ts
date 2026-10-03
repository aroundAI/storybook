import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PROMPT_REGISTRY } from '../src/prompts/lambda-registry';

/**
 * The server writer renders `brief.prompt.slug` from the Lambda registry
 * (src/writers/server-writer.ts), and a slug it lacks fails the run with
 * "Prompt template not found". A stage builds its brief from a prompt file
 * it imports, so every prompt a registered stage imports must be in the
 * registry under that file's slug. `fact_extraction` (#561) wrote through
 * `documentary/fact-extraction` in the web executor's registry; under a
 * run it writes through this one, which had no entry for it.
 */

const STAGES = resolve(__dirname, '../../features/generation/src/stages');
const PROMPTS = resolve(__dirname, '../../features/prompt-engine/src/prompts');
const PROMPT_IMPORT = /@kit\/prompt-engine\/prompts\/([\w/-]+\.json)/g;

function stagePrompts() {
  return readdirSync(STAGES)
    .filter((file) => file.endsWith('.ts'))
    .flatMap((file) =>
      [...readFileSync(join(STAGES, file), 'utf8').matchAll(PROMPT_IMPORT)].map(
        ([, prompt]) => {
          const { slug } = JSON.parse(
            readFileSync(join(PROMPTS, prompt!), 'utf8'),
          ) as { slug: string };

          return { file, prompt: prompt!, slug };
        },
      ),
    );
}

describe('every stage prompt is in the Lambda registry (FILM-1902)', () => {
  it('finds the stages’ prompts', () => {
    expect(stagePrompts().length).toBeGreaterThanOrEqual(14);
  });

  it('registers each prompt a stage imports under its slug', () => {
    const missing = stagePrompts()
      .filter(({ slug }) => !PROMPT_REGISTRY[slug])
      .map(({ file, prompt, slug }) => `${file}: ${prompt} (${slug})`);

    expect(missing).toEqual([]);
  });
});
