import type { Brief, GenerationRun, GenerationUsage } from './types';

/**
 * The run a server-mode caller commits under, built from what it knows:
 * the brief it sent and the usage the executor reported. FILM-1903 gives
 * runs a row and an id; until then `runId` is whatever the caller has.
 */
export function serverRun(input: {
  brief?: Pick<Brief, 'prompt'>;
  usage?: GenerationUsage;
  runId?: string;
  now?: Date;
  /** Server-side figures the writer reported, for commit to record */
  diagnostics?: Record<string, unknown>;
}): GenerationRun {
  return {
    id: input.runId,
    mode: 'server',
    origin: {
      kind: 'server',
      runId: input.runId,
      model: input.usage?.model,
      promptSlug: input.brief?.prompt.slug,
      promptVersion: input.brief?.prompt.version,
      at: (input.now ?? new Date()).toISOString(),
    },
    usage: input.usage,
    diagnostics: input.diagnostics,
  };
}
