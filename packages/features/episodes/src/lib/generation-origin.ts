import { z } from 'zod';

/**
 * What the web reads from a `generation_origin` value (FILM-1903 stamps it,
 * FILM-1910 shows it). Lenient on purpose: a badge needs `kind`, and shows
 * the model and client when present. Anything else, including a value
 * written before FILM-1903 (null), reads as "no origin" and shows no badge.
 */
const DisplayOriginSchema = z.object({
  kind: z.enum(['server', 'external', 'human']),
  model: z.string().min(1).optional().catch(undefined),
  clientName: z.string().min(1).optional().catch(undefined),
  at: z.string().optional().catch(undefined),
});

export type DisplayOrigin = z.infer<typeof DisplayOriginSchema>;

export function parseGenerationOrigin(value: unknown): DisplayOrigin | null {
  const parsed = DisplayOriginSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * `episodes.generation_origin` is keyed by stage (`{"story": {...},
 * "screenplay": {...}}`). The most recent origin among `stages`, so the
 * story shows its refinement's author once one has been applied.
 */
export function latestStageOrigin(
  episodeOrigin: unknown,
  stages: readonly string[],
): DisplayOrigin | null {
  if (!episodeOrigin || typeof episodeOrigin !== 'object') return null;

  const byStage = episodeOrigin as Record<string, unknown>;

  return stages
    .map((stage) => parseGenerationOrigin(byStage[stage]))
    .filter((origin): origin is DisplayOrigin => origin !== null)
    .reduce<DisplayOrigin | null>(
      (latest, origin) =>
        !latest || (origin.at ?? '') > (latest.at ?? '') ? origin : latest,
      null,
    );
}

/** The client an external run came from, as a person would name it. */
export function externalClientLabel(clientName: string | null | undefined) {
  if (!clientName || /claude/i.test(clientName)) return 'Claude';
  return clientName;
}

/**
 * The badge text: "Gemini", "Claude via MCP" or "Edited". An external
 * model is self-reported by the client, so it is labelled "reported".
 */
export function originLabel(origin: DisplayOrigin): {
  label: string;
  detail: string | null;
} {
  switch (origin.kind) {
    case 'server':
      return { label: 'Gemini', detail: origin.model ?? null };
    case 'external':
      return {
        label: `${externalClientLabel(origin.clientName)} via MCP`,
        detail: origin.model ? `reported: ${origin.model}` : null,
      };
    case 'human':
      return { label: 'Edited', detail: null };
  }
}
