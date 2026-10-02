import type { ZodType, z } from 'zod';

import { McpToolError } from '../../errors';

/**
 * Re-validates a tool's input with the web form's own Zod schema, so a tool
 * and its form refuse the same things, and turns a refusal into the error
 * contract: VALIDATION_FAILED with `details.errors[]` field by field.
 */
export function parseWith<S extends ZodType>(
  schema: S,
  value: unknown,
): z.infer<S> {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new McpToolError('VALIDATION_FAILED', 'The input was refused.', {
      details: {
        errors: result.error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      },
    });
  }

  return result.data;
}

/** A refusal a service returned for one field, in the same contract. */
export function refused(message: string, field?: string): McpToolError {
  return new McpToolError('VALIDATION_FAILED', message, {
    details: { errors: [{ path: field ? [field] : [], message }] },
  });
}

/** Drops `undefined` values so a partial object merges without erasing keys. */
export function compact<T extends Record<string, unknown>>(
  value: T,
): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}
