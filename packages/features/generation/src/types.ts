/**
 * Core types of the generation core (FILM-1901, EDD "Core types").
 *
 * A stage is one AI generation step: it prepares a Brief, something writes
 * the output (Gemini in the worker, Claude over MCP), and the stage checks
 * and commits it. The same StageDefinition serves both entry points, so
 * nothing in here reaches a model: no `@kit/llm`, no model SDK, no
 * `server-only` (the LLM worker is esbuild-bundled and imports this).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { z } from 'zod';

import type { GenerationJobType } from '@kit/prompt-engine/generation-job-types';
import type { Database } from '@kit/supabase/database';

export const GenerationModeSchema = z.enum(['server', 'external']);
export type GenerationMode = z.infer<typeof GenerationModeSchema>;

export const StageKeySchema = z.enum([
  'season_outline',
  'ideation',
  'story',
  'story_refinement',
  'screenplay',
  'screenplay_refinement',
  'shots',
  'audio_cues',
  'dialogue_translation',
  'asset_description',
  'publish_metadata',
  'season_analysis',
  'fact_extraction',
  'episode_summary',
  // Server-only keys (FILM-1903 part B): model calls with no content stage,
  // and the worker's audio render job. They have a run, never a brief, and
  // no StageDefinition serves them.
  'analytics_insights',
  'language_insights',
  'fact_check',
  'audio_render',
]);
export type StageKey = z.infer<typeof StageKeySchema>;

export const TargetTypeSchema = z.enum([
  'episode',
  'scene',
  'asset',
  'season',
  'project',
  'publish',
  'audio_cue',
]);
export type TargetType = z.infer<typeof TargetTypeSchema>;

export const GenerationOriginSchema = z.object({
  kind: z.enum(['server', 'external', 'human']),
  runId: z.string().uuid().optional(),
  /** Self-reported when external */
  model: z.string().optional(),
  promptSlug: z.string().optional(),
  promptVersion: z.number().int().optional(),
  /** e.g. MCP clientInfo.name */
  clientName: z.string().optional(),
  at: z.string().datetime(),
});
export type GenerationOrigin = z.infer<typeof GenerationOriginSchema>;

export const CheckErrorSchema = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
});
export type CheckError = z.infer<typeof CheckErrorSchema>;

export const PartSpecSchema = z.object({
  key: z.string(),
  index: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  label: z.string(),
});
export type PartSpec = z.infer<typeof PartSpecSchema>;

export type JsonSchema = Record<string, unknown>;

/**
 * What a writer needs to produce one part. In server mode the worker's
 * executor renders `prompt.slug` with `prompt.variables` itself (the same
 * `renderTemplate`), so `instructions` is that text as data for an external
 * agent, not a second source of it.
 */
export interface Brief {
  runId?: string;
  stage: StageKey;
  part: PartSpec;
  prompt: {
    slug: string;
    version: number;
    variables: Record<string, unknown>;
  };
  /** The system layers, then the rendered user prompt */
  instructions: string;
  /** The structured inputs, for an agent to reason over */
  context: Record<string, unknown>;
  /** JSON Schema generated from the stage's Zod output schema */
  outputSchema: JsonSchema;
  example?: unknown;
  /** The matching quality-evaluation prompt, rendered as a self-check */
  qualityRubric?: string;
  /** What commit will enforce deterministically */
  constraints: Record<string, unknown>;
  /** `episodes.version` when the target has one; null when it does not */
  targetVersion: number | null;
  expiresAt: string;
}

export interface GenerationUsage {
  provider: string;
  model: string;
  tokens: number;
  latencyMs?: number;
}

/**
 * The run a commit belongs to. `generation_runs` (FILM-1903) will give it an
 * id, a lease and a target version; until then the worker builds this from
 * the job it is running.
 */
export interface GenerationRun {
  id?: string;
  mode: GenerationMode;
  origin: GenerationOrigin;
  usage?: GenerationUsage;
  /**
   * Server-side figures the writer reports about itself (an orchestrator's
   * step count, an evaluator's coverage), recorded on the job's output_data
   * by a tracked stage's commit. Nothing in here is content.
   */
  diagnostics?: Record<string, unknown>;
}

/** Prompt-ready text about an episode's world, as the worker builds it today. */
export interface EpisodeContextSnapshot {
  episodeNumber: number;
  seasonNumber?: number;
  seasonPremise?: string;
  seasonDirectionNotes?: string;
  /** Characters formatted for a prompt; '' when there are none */
  characters: string;
  locations: string;
  previousEpisodes: string;
  counts: { characters: number; locations: number };
  /** The same characters and locations in the VEO 3.1 format shots use */
  charactersVeo?: string;
  locationsVeo?: string;
  /** Recurring story elements, formatted for a prompt; '' when none */
  recurringElements?: string;
  /** The names, for referential checks */
  characterNames?: string[];
  locationNames?: string[];
  /** The same assets with their ids, for a speaker → asset id map */
  characterList?: Array<{ id: string; name: string }>;
  locationList?: Array<{ id: string; name: string }>;
  genre?: string;
  targetAudience?: string;
  visualStyle?: string;
  /** The episode's premise (story_data.premise, else its description) */
  premise?: string;
  projectType?: string;
  /** Facts linked to the episode, formatted; '' when there are none */
  episodeFacts?: string;
  /** The project's verified facts, formatted; undefined when none */
  verifiedFacts?: string;
  /** The previous episodes by number and title, for a one-line listing */
  previousEpisodeTitles?: Array<{ number: number; title: string }>;
}

export type EpisodeContextLoader = (
  episodeId: string,
  options: { semanticQuery?: string },
) => Promise<EpisodeContextSnapshot>;

export interface RevisionSnapshot {
  table: string;
  rowId: string;
  column: string;
  before: unknown;
  stage: StageKey;
  runId?: string;
}

/**
 * Everything a stage may touch. The Supabase client is the caller's: a
 * user-scoped JWT over MCP, the service role (with an authorised target) in
 * the worker. The optional capabilities are seams for work that lands in
 * other specs or lives outside this package:
 *
 * - `episodeContext`: the worker's context builder reaches an embedding
 *   model for semantic recall (KB-35), which this package never imports.
 * - `revisions`: `content_revisions` arrives with FILM-1903; commit calls
 *   `snapshot` when it is present.
 * - `originColumnsAvailable`: `generation_origin` columns arrive with
 *   FILM-1903; until then commit stamps no origin.
 */
export interface Ctx {
  client: SupabaseClient<Database>;
  accountId: string;
  userId: string;
  episodeContext?: EpisodeContextLoader;
  revisions?: { snapshot(input: RevisionSnapshot): Promise<void> };
  originColumnsAvailable?: boolean;
  log?: (message: string) => void;
}

export interface CommitResult<TData = unknown> {
  status: 'committed' | 'skipped';
  /** Why nothing was written, when `skipped` */
  reason?: string;
  data: TData;
  /**
   * Stages this commit chains (shots -> audio_cues). The run layer opens
   * each as a child run in the parent's mode; a server child is queued, an
   * external one waits for the agent (FILM-1903).
   */
  followOns?: CommitFollowOn[];
  /**
   * The story stage's form of the same idea (#562): a description per
   * asset it invented, as `{ stage, target: { assetId } }`. Not a runnable
   * target yet: `asset_description` takes the asset's name and type, so the
   * run layer leaves these to the handler until FILM-1908 opens them.
   */
  followOn?: Array<{ stage: StageKey; target: Record<string, unknown> }>;
}

export interface CommitFollowOn {
  stage: StageKey;
  target: {
    type: TargetType;
    id: string;
    projectId: string | null;
    input: { kind: 'stage'; target: unknown };
    targetVersion?: number | null;
  };
}

/** The generation_jobs row a tracked stage updates as it runs. */
export interface JobTracking<TTarget> {
  jobType: GenerationJobType;
  reference(target: TTarget): { type: 'episode'; id: string };
}

/**
 * The generation_jobs.job_type a tracked stage updates: the one copy held
 * to generation_jobs_job_type_check by prompt-engine's test (KB-174).
 */
export type { GenerationJobType } from '@kit/prompt-engine/generation-job-types';

/**
 * One AI stage. The model call sits between `prepare` and `commit` and is
 * supplied by the caller (`GenerateFn`), so the definition itself never
 * chooses a writer.
 */
export interface StageDefinition<TTarget, TOut, TData = unknown> {
  key: StageKey;
  targetType: TargetType;
  targetSchema: z.ZodType<TTarget, z.ZodTypeDef, unknown>;
  outputSchema: z.ZodType<TOut, z.ZodTypeDef, unknown>;
  jobTracking?: JobTracking<TTarget>;
  parts(ctx: Ctx, target: TTarget): Promise<PartSpec[]>;
  prepare(ctx: Ctx, target: TTarget, part: PartSpec): Promise<Brief>;
  check(
    ctx: Ctx,
    target: TTarget,
    out: TOut,
    part: PartSpec,
  ): Promise<CheckError[]>;
  commit(
    ctx: Ctx,
    run: GenerationRun,
    target: TTarget,
    outputs: TOut[],
  ): Promise<CommitResult<TData>>;
}

/** Any stage, for the registry and generic callers. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyStageDefinition = StageDefinition<any, any, any>;

export interface GenerateResult {
  output: unknown;
  usage?: GenerationUsage;
  /** Merged into the run's `diagnostics` for commit to record */
  diagnostics?: Record<string, unknown>;
}

export type GenerateFn = (brief: Brief) => Promise<GenerateResult>;
