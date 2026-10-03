import { createHash } from 'node:crypto';

import { McpToolError } from '../../../errors';

/**
 * NFR-5: a brief stays under about 60 KB and a submission under about
 * 100 KB, so one tool call carries either comfortably. Measured as UTF-8
 * bytes of the JSON a client sends or receives.
 */
export const BRIEF_MAX_BYTES = 60 * 1024;
export const SUBMISSION_MAX_BYTES = 100 * 1024;

export function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
}

/** VALIDATION_FAILED with a size code, before anything is parsed or stored. */
export function assertSubmissionSize(output: unknown) {
  const bytes = jsonBytes(output);

  if (bytes > SUBMISSION_MAX_BYTES) {
    throw new McpToolError(
      'VALIDATION_FAILED',
      `The output is ${bytes} bytes; a submission is limited to ${SUBMISSION_MAX_BYTES}. Submit the stage part by part.`,
      {
        details: {
          errors: [
            {
              path: 'output',
              code: 'too_large',
              message: `${bytes} bytes, over the ${SUBMISSION_MAX_BYTES}-byte limit`,
            },
          ],
          bytes,
          limit: SUBMISSION_MAX_BYTES,
        },
      },
    );
  }

  return bytes;
}

/** JSON with sorted keys, so two equal submissions hash the same. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

    return `{${entries
      .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value ?? null);
}

/** The idempotency key of a submission: its output and the model it names. */
export function submissionHash(output: unknown, model?: string): string {
  return createHash('sha256')
    .update(stableJson({ output, model: model ?? null }))
    .digest('hex');
}
