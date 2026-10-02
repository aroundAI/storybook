import type { z } from 'zod';

import type { CheckError } from './types';

/** A Zod issue as a `{path, code, message}` an agent can act on. */
export function issueToCheckError(issue: z.ZodIssue): CheckError {
  return {
    path: issue.path.map(String).join('.'),
    code: issue.code,
    message: issue.message,
  };
}

/**
 * Validates `value` against `schema`; the errors are the deterministic
 * schema check both modes run first.
 */
export function checkWithSchema<TOut>(
  schema: z.ZodType<TOut, z.ZodTypeDef, unknown>,
  value: unknown,
): { ok: true; value: TOut } | { ok: false; errors: CheckError[] } {
  const parsed = schema.safeParse(value);

  if (parsed.success) return { ok: true, value: parsed.data };

  return { ok: false, errors: parsed.error.issues.map(issueToCheckError) };
}

/** Thrown by the server runner when a model reply fails the stage's checks. */
export class StageOutputRejected extends Error {
  override readonly name = 'StageOutputRejected';

  constructor(
    readonly stage: string,
    readonly partKey: string,
    readonly errors: CheckError[],
  ) {
    super(
      `${stage} output for part ${partKey} rejected: ${errors
        .map((e) => `${e.path || '<root>'} ${e.code} (${e.message})`)
        .join('; ')}`,
    );
  }
}
