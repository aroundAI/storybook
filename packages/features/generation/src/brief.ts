/**
 * `buildBrief` turns a stage's prompt JSON into the Brief both modes use.
 * The prompt files stay the single source of creative direction: in server
 * mode the executor renders them for Gemini, in external mode the same
 * rendering is returned as data.
 */
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import ideaQuality from '@kit/prompt-engine/prompts/quality-evaluation/idea-quality.json';
import screenplayQuality from '@kit/prompt-engine/prompts/quality-evaluation/screenplay-quality.json';
import shotQuality from '@kit/prompt-engine/prompts/quality-evaluation/shot-quality.json';
import storyQuality from '@kit/prompt-engine/prompts/quality-evaluation/story-quality.json';
import translationQuality from '@kit/prompt-engine/prompts/quality-evaluation/translation-quality.json';
import {
  type RenderableTemplate,
  assertPromptLlm,
  renderTemplate,
} from '@kit/prompt-engine/render-template';

import type { Brief, JsonSchema, PartSpec, StageKey } from './types';

/** How long a brief stays valid: the lease FILM-1903 gives a run. */
export const BRIEF_TTL_MS = 30 * 60 * 1000;

/** The fields of a prompt JSON file this package reads. */
export interface PromptFile extends RenderableTemplate {
  slug: string;
  name?: string;
  version: string | number;
  llm?: { provider?: string; model?: string };
  output?: {
    example_output?: unknown;
  };
}

/** The quality-evaluation prompt a stage's output is judged against. */
const QUALITY_RUBRICS: Partial<Record<StageKey, PromptFile>> = {
  ideation: ideaQuality as PromptFile,
  story: storyQuality as PromptFile,
  story_refinement: storyQuality as PromptFile,
  screenplay: screenplayQuality as PromptFile,
  screenplay_refinement: screenplayQuality as PromptFile,
  shots: shotQuality as PromptFile,
  dialogue_translation: translationQuality as PromptFile,
};

export function qualityRubricFor(stage: StageKey): PromptFile | undefined {
  return QUALITY_RUBRICS[stage];
}

/**
 * Renders a quality-evaluation prompt as a self-check. Its variables name
 * the text under evaluation, which does not exist yet when the brief is
 * built, so the caller passes what it knows and the rest reads as a
 * placeholder the agent fills with its own output.
 */
export function renderQualityRubric(
  prompt: PromptFile,
  variables: Record<string, unknown>,
): string {
  const declared = prompt.variables ?? {};
  const filled: Record<string, unknown> = { ...variables };

  for (const [name, spec] of Object.entries(declared)) {
    if (filled[name] === undefined && spec.default === undefined) {
      filled[name] = `<the ${name.replace(/_/g, ' ')} you produce>`;
    }
  }

  const { systemPrompt, userPrompt } = renderTemplate(
    prompt.slug,
    prompt,
    filled,
  );

  return `${systemPrompt}\n\n${userPrompt}`;
}

export function toJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  return zodToJsonSchema(schema, { $refStrategy: 'none' }) as JsonSchema;
}

export interface BuildBriefInput {
  stage: StageKey;
  part: PartSpec;
  prompt: PromptFile;
  variables: Record<string, unknown>;
  context: Record<string, unknown>;
  outputSchema: z.ZodTypeAny;
  constraints?: Record<string, unknown>;
  targetVersion: number | null;
  runId?: string;
  /** Variables for the stage's quality rubric, when it has one */
  rubricVariables?: Record<string, unknown>;
  now?: Date;
}

export function buildBrief(input: BuildBriefInput): Brief {
  const { prompt } = input;

  assertPromptLlm(prompt.slug, prompt);

  const { systemPrompt, userPrompt } = renderTemplate(
    prompt.slug,
    prompt,
    input.variables,
  );

  const rubric = qualityRubricFor(input.stage);
  const now = input.now ?? new Date();

  return {
    runId: input.runId,
    stage: input.stage,
    part: input.part,
    prompt: {
      slug: prompt.slug,
      version: Number(prompt.version) || 1,
      variables: input.variables,
    },
    instructions: `${systemPrompt}\n\n${userPrompt}`,
    context: input.context,
    outputSchema: toJsonSchema(input.outputSchema),
    example: prompt.output?.example_output,
    qualityRubric: rubric
      ? renderQualityRubric(rubric, input.rubricVariables ?? {})
      : undefined,
    constraints: input.constraints ?? {},
    targetVersion: input.targetVersion,
    expiresAt: new Date(now.getTime() + BRIEF_TTL_MS).toISOString(),
  };
}

/** A single-part stage's one part. */
export function singlePart(key: string, label: string): PartSpec {
  return { key, index: 0, total: 1, label };
}

export { z };
