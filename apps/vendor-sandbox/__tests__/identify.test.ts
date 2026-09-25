import { describe, expect, it } from 'vitest';

import {
  SCHEMA_FOR_LLM_HEADER,
  loadCatalog,
  matches,
} from '../src/llm/prompts';
import { identify } from '../src/llm/respond';
import { variablesFor } from './helpers';

/**
 * FILM-1803 §2, "Identifying the prompt": a request carries the rendered
 * prompt, not its slug, so each prompt is recognised by its own literal text.
 * Every system prompt, rendered as each executor renders it, must be
 * recognised as itself and as nothing else.
 */

const catalog = loadCatalog();

type Template = (typeof catalog)[number]['template'];

function substitute(text: string, variables: Record<string, unknown>) {
  let out = text;
  for (const [name, value] of Object.entries(variables)) {
    out = out.replaceAll(`{{${name}}}`, String(value));
  }
  return out;
}

function parts(template: Template) {
  return Array.isArray(template.system_prompts)
    ? template.system_prompts
    : [{ content: template.system_prompt ?? '', order: 0 }];
}

/** `@kit/prompt-engine`'s loader: parts sorted by `order`, variables filled. */
function asPackageRenders(template: Template) {
  const variables = variablesFor(Object.keys(template.variables ?? {}));
  const system = [...parts(template)]
    .sort((a, b) => a.order - b.order)
    .map((p) => substitute(p.content, variables))
    .join('\n\n');
  const schema = template.output?.schema_for_llm;
  return schema ? system + SCHEMA_FOR_LLM_HEADER + schema : system;
}

/** The llm-worker's renderer: file order, unfilled placeholders removed. */
function asLambdaRenders(template: Template) {
  const system = parts(template)
    .map((p) => p.content)
    .join('\n\n')
    .replace(/\{\{\s*\w+\s*\}\}/g, '');
  const schema = template.output?.schema_for_llm;
  return schema ? system + SCHEMA_FOR_LLM_HEADER + schema : system;
}

describe('identifying a prompt from its rendered system prompt', () => {
  it.each(catalog.map((p) => [p.key, p] as const))('%s', (key, prompt) => {
    expect(
      prompt.fragments.flat().length,
      `${key} has no text to be recognised by`,
    ).toBeGreaterThan(0);

    for (const rendered of [
      asPackageRenders(prompt.template),
      asLambdaRenders(prompt.template),
    ]) {
      expect(identify(rendered, catalog)).toEqual({ kind: 'prompt', key });

      const others = catalog.filter(
        (p) => p.key !== key && matches(rendered, p.fragments),
      );
      expect(
        others.map((p) => p.key),
        `${key} is also recognised as another prompt`,
      ).toEqual([]);
    }
  });

  it('does not recognise a system prompt it has never seen', () => {
    expect(
      identify('You are a helpful assistant. Answer briefly.', catalog),
    ).toEqual({
      kind: 'unrecognised',
    });
  });

  it('does not recognise half of a prompt', () => {
    const prompt = catalog.find((p) => p.key === 'story-ideation')!;
    const rendered = asPackageRenders(prompt.template);
    expect(identify(rendered.slice(0, rendered.length / 2), catalog)).toEqual({
      kind: 'unrecognised',
    });
  });
});
