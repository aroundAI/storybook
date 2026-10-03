/**
 * KB-177: the KB-126 rule, for the prompts a stage renders. A prompt is
 * filled by name, so a stage that sends its data under a name the template
 * does not read gets no error: the executor re-renders
 * `brief.prompt.variables`, and the data goes nowhere. prompt-engine's
 * static scan reads only `templateSlug` calls with a literal `variables`
 * object; a stage passes `buildBrief` a local, a helper's result or a
 * wrapped literal, so the stages are checked here, on what `prepare()`
 * actually passed.
 */
import type { BuildBriefInput, PromptFile } from '../../src/brief';
import { qualityRubricFor } from '../../src/brief';

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

function placeholdersOf(prompt: PromptFile): Set<string> {
  const text = [
    prompt.user_prompt ?? '',
    prompt.system_prompt ?? '',
    ...(prompt.system_prompts ?? []).map((part) => part.content),
  ].join('\n');

  return new Set([...text.matchAll(PLACEHOLDER)].map((match) => match[1]!));
}

function provided(value: unknown): boolean {
  return value !== undefined && value !== null;
}

/**
 * What is wrong with one `buildBrief` call, as lines naming the prompt:
 * a key its template never reads, a placeholder left with no value and no
 * default, and a key sent to the stage's quality rubric that the rubric
 * never reads. The rubric's own unfilled placeholders are meant: they name
 * the text the writer has yet to produce (`renderQualityRubric`).
 */
export function promptVariableProblems(input: BuildBriefInput): string[] {
  const { prompt, variables } = input;
  const read = placeholdersOf(prompt);
  const declared = prompt.variables ?? {};
  const problems: string[] = [];

  for (const key of Object.keys(variables)) {
    if (!read.has(key)) {
      problems.push(`${prompt.slug}: sends "${key}", which it never reads`);
    }
  }

  for (const name of read) {
    if (!provided(variables[name]) && declared[name]?.default === undefined) {
      problems.push(`${prompt.slug}: leaves {{${name}}} unfilled`);
    }
  }

  const rubric = qualityRubricFor(input.stage);

  if (rubric) {
    const rubricReads = placeholdersOf(rubric);

    for (const key of Object.keys(input.rubricVariables ?? {})) {
      if (!rubricReads.has(key)) {
        problems.push(
          `${rubric.slug} (rubric of ${input.stage}): sends "${key}", which it never reads`,
        );
      }
    }
  } else if (input.rubricVariables) {
    problems.push(
      `${input.stage}: sends rubric variables, but the stage has no rubric`,
    );
  }

  return problems;
}
