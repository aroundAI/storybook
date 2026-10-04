/**
 * The shape of every LLM job, on both sides of the queue (KB-33).
 *
 * `queueLlmJob` parses the payload it is about to send, and each worker
 * handler parses the payload it received, with the same schema. A job whose
 * producer and handler disagree fails at the edge, naming the field, instead
 * of reaching a prompt or a query as `undefined`.
 *
 * Unknown keys are stripped, not refused: a message sent by an older
 * producer still parses. No `server-only` import: the Lambda worker imports
 * this module.
 */
import { z } from 'zod';

const id = z.string().uuid();

/** Stamped by `queueLlmJob` from the job's authorised target (KB-31). */
const accountId = id;

/**
 * The user the job runs for. When a payload carries one, it must be the
 * message's `userId`: the worker checks access for that one, and handlers
 * attribute their writes to it.
 */
const userId = id;

const StoryIdeation = z.object({
  accountId,
  projectId: id.optional(),
  episodeId: id,
  userId,
  premise: z.string(),
  numberOfIdeas: z.number().int().positive().optional(),
});

const StoryGeneration = z.object({
  accountId,
  projectId: id,
  episodeId: id,
  userId,
  title: z.string(),
  logline: z.string(),
  // The defaults `createEpisodeAction` already applies; the bulk path sent
  // neither, and the handler scaled the story from `undefined`
  targetDuration: z.number().default(300),
  contentStyle: z.string().default('dialogue-heavy'),
  style: z.string().optional(),
  version: z.number(),
  threadCandidates: z
    .array(
      z.object({
        threadId: z.string(),
        threadName: z.string(),
        action: z.enum(['progress', 'resolve']),
      }),
    )
    .optional(),
  themes: z.array(z.string()).optional(),
  hook: z.string().optional(),
  visualDirection: z.string().optional(),
});

const Refinement = z.object({
  accountId,
  projectId: id,
  episodeId: id,
  userId,
  feedback: z.string(),
});

const ScreenplayConversion = z.object({
  accountId,
  projectId: id,
  episodeId: id,
  userId,
  dialogueStyle: z.string().optional(),
  contentStyle: z.string().optional(),
  version: z.number(),
});

/** How long one generated shot may run, in seconds (KB-120). */
export const SHOT_DURATION_LIMITS = { min: 3, max: 10 } as const;
export const DEFAULT_SHOT_DURATION = { min: 5, max: 8 } as const;

const shotSeconds = z
  .number()
  .min(SHOT_DURATION_LIMITS.min)
  .max(SHOT_DURATION_LIMITS.max);

/** A shot's length, held to the range the job asked for. */
export function clampShotDuration(
  seconds: number,
  range: { min: number; max: number },
): number {
  if (!Number.isFinite(seconds)) return range.max;
  return Math.min(range.max, Math.max(range.min, seconds));
}

/**
 * `shots.duration_seconds` is an integer column, while a model's shot may
 * last 8.35 seconds (the prompt's schema allows it) and an edit may say 7.5.
 * Every write stores whole seconds, at least one, so neither fails the insert
 * (KB-130).
 */
export function wholeShotSeconds(seconds: number) {
  return Math.max(1, Math.round(seconds));
}

const ShotGeneration = z
  .object({
    accountId,
    projectId: id,
    episodeId: id,
    userId,
    version: z.number(),
    shotDurationMin: shotSeconds.default(DEFAULT_SHOT_DURATION.min),
    shotDurationMax: shotSeconds.default(DEFAULT_SHOT_DURATION.max),
  })
  .refine((job) => job.shotDurationMin <= job.shotDurationMax, {
    message: 'must not be less than shotDurationMin',
    path: ['shotDurationMax'],
  });

const SeasonAnalysis = z.object({
  accountId,
  projectId: id,
  userId: userId.optional(),
  roadmap: z.string(),
  externalFacts: z
    .array(
      z.object({
        id: z.string().optional(),
        claim: z.string(),
        source_citation: z.string().nullish(),
        category: z.string().nullish(),
      }),
    )
    .optional(),
});

/** An outline the season already has, given as context (KB-121). */
const NeighbouringEpisode = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  premise: z.string(),
  mainPlot: z.string(),
  characterFocus: z.array(z.string()).optional(),
  arcPosition: z.string(),
});

const SeasonOutline = z.object({
  accountId,
  projectId: id,
  userId,
  seasonId: id.optional(),
  seasonPremise: z.string(),
  episodeCount: z.number().int().positive(),
  startingNumber: z.number().int(),
  genre: z.string().optional(),
  style: z.string().optional(),
  // Regenerating one episode: the outlines around it, and the user's note
  surroundingEpisodes: z.array(NeighbouringEpisode).max(24).optional(),
  additionalContext: z.string().max(500).optional(),
});

const BatchTranslateMetadata = z.object({
  accountId,
  userId: userId.optional(),
  items: z.array(
    z.object({
      id: z.string(),
      contentType: z.enum(['full-video', 'shorts-group']),
      title: z.string(),
      description: z.string(),
      targetLanguage: z.string(),
      groupId: z.string().optional(),
      groupName: z.string().optional(),
    }),
  ),
});

const metricsRecord = z.record(z.unknown());

const AnalyticsInsights = z.object({
  accountId,
  projectId: id,
  userId,
  refresh: z.boolean().optional(),
  analytics: z.object({
    totals: z.object({
      // Null where every row is Facebook's: no single view (KB-153).
      views: z.number().nullable(),
      likes: z.number(),
      comments: z.number(),
      // Null where no row measured it: X reports no shares (FILM-1727).
      shares: z.number().nullable(),
      // Null is "not measured" (KB-149).
      watchTimeSeconds: z.number().nullable(),
      subscribersGained: z.number().nullable(),
      // Null where no day's earnings were measured (FILM-1726).
      revenueCents: z.number().nullable(),
      contentCount: z.number(),
    }),
    previousPeriodTotals: z.record(z.number().nullable()).optional(),
    platformMetrics: z
      .array(
        z.object({
          platform: z.string(),
          views: z.number().nullable(),
          likes: z.number(),
          comments: z.number(),
          // Null where the platform reports no shares: X (FILM-1727).
          shares: z.number().nullable(),
        }),
      )
      .optional(),
    topContent: z
      .array(
        z.object({
          id: z.string(),
          title: z.string(),
          views: z.number().nullable(),
          likes: z.number(),
          engagementRate: z.number().nullable(),
          platform: z.string(),
        }),
      )
      .optional(),
    audience: metricsRecord.optional(),
    trendFacts: z
      .array(
        z.object({
          metric: z.enum(['views', 'likes', 'comments', 'shares']),
          platform: z.string(),
          current: z.number(),
          previous: z.number(),
          changePercent: z.number(),
        }),
      )
      .max(40)
      .optional(),
    contentCount: z.number(),
    avgEngagementRate: z.number(),
  }),
});

/**
 * Aggregates the producer computes and the handler passes to the prompt as
 * they are; only their presence is part of the contract.
 */
const LanguageInsights = z.object({
  accountId,
  projectId: id,
  userId,
  languagePerformance: z.array(z.unknown()),
  platformMatrix: z.array(z.unknown()),
  contentType: z.unknown(),
  shorts: z.array(z.unknown()),
  geography: z.unknown(),
});

const TranslateDialogue = z.object({
  accountId,
  projectId: id.optional(),
  episodeId: id,
  userId,
  targetLanguage: z.string(),
  preserveTiming: z.boolean(),
  /**
   * More languages for the same run, translated in turn after
   * `targetLanguage` (FILM-2007): one translation run per episode can be
   * open at a time, so a localization into several languages is one run.
   */
  additionalLanguages: z.array(z.string().min(1)).max(10).optional(),
});

const AudioCueGeneration = z.object({
  accountId,
  projectId: id,
  episodeId: id,
  userId: userId.optional(),
});

export const AudioCueTypeSchema = z.enum(['sfx', 'ambient', 'music']);

const AudioFileGeneration = z.object({
  accountId,
  projectId: id,
  episodeId: id,
  userId: userId.optional(),
  cueId: id,
  cueType: AudioCueTypeSchema,
  prompt: z.string(),
  durationSeconds: z.number(),
  startOffsetSeconds: z.number(),
});

const FactExtraction = z.object({
  accountId,
  projectId: id,
  userId,
  content: z.string(),
  sourceTitle: z.string(),
  sourceCitation: z.string().optional(),
});

const AssetCreation = z.object({
  accountId,
  projectId: id,
  episodeId: id,
  userId,
});

/** One schema per job type the LLM worker runs. */
export const LlmJobPayloadSchemas = {
  'season-analysis': SeasonAnalysis,
  'season-outline': SeasonOutline,
  'story-ideation': StoryIdeation,
  'story-generation': StoryGeneration,
  'story-refinement': Refinement,
  'screenplay-conversion': ScreenplayConversion,
  'screenplay-refinement': Refinement,
  'shot-generation': ShotGeneration,
  'batch-translate-metadata': BatchTranslateMetadata,
  'analytics-insights': AnalyticsInsights,
  'language-insights': LanguageInsights,
  'translate-dialogue': TranslateDialogue,
  'audio-cue-generation': AudioCueGeneration,
  'audio-file-generation': AudioFileGeneration,
  'fact-extraction': FactExtraction,
  'asset-creation': AssetCreation,
} as const;

export type LlmJobType = keyof typeof LlmJobPayloadSchemas;

export const LLM_JOB_TYPES = Object.keys(LlmJobPayloadSchemas) as [
  LlmJobType,
  ...LlmJobType[],
];

/** What a handler receives for `T`. */
export type LlmJobPayload<T extends LlmJobType> = z.output<
  (typeof LlmJobPayloadSchemas)[T]
>;

type Stamped = 'accountId' | 'projectId' | 'episodeId' | 'userId';

type PayloadInput<T extends LlmJobType> = z.input<
  (typeof LlmJobPayloadSchemas)[T]
>;

/**
 * What a producer passes to `queueLlmJob` for `T`. The target's ids and the
 * job's user are stamped by `queueLlmJob`, so they may be left out.
 */
export type LlmJobPayloadInput<T extends LlmJobType> = Omit<
  PayloadInput<T>,
  Stamped
> &
  Partial<Pick<PayloadInput<T>, Extract<keyof PayloadInput<T>, Stamped>>>;

/** The SQS message around every payload. */
export const LlmJobMessageSchema = z.object({
  jobType: z.enum(LLM_JOB_TYPES),
  userId: id,
  payload: z.record(z.unknown()),
});

export type LlmJobMessage = z.output<typeof LlmJobMessageSchema>;

function describe(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

/**
 * The payload as `T`'s schema reads it, or an error naming each field that
 * does not fit.
 */
export function parseLlmJobPayload<T extends LlmJobType>(
  jobType: T,
  payload: unknown,
): LlmJobPayload<T> {
  const result = LlmJobPayloadSchemas[jobType].safeParse(payload);

  if (!result.success) {
    throw new Error(`Invalid ${jobType} payload: ${describe(result.error)}`);
  }

  return result.data as LlmJobPayload<T>;
}

/**
 * The SQS message, with its payload parsed for its job type. A payload
 * naming a different user than the message is refused: the worker's access
 * check and the handler's attribution must be about the same person.
 */
export function parseLlmJobMessage(body: unknown): {
  jobType: LlmJobType;
  userId: string;
  payload: LlmJobPayload<LlmJobType>;
} {
  const message = LlmJobMessageSchema.safeParse(body);

  if (!message.success) {
    throw new Error(`Invalid LLM job message: ${describe(message.error)}`);
  }

  const { jobType, userId: messageUserId } = message.data;
  const payload = parseLlmJobPayload(jobType, message.data.payload);

  if (
    'userId' in payload &&
    payload.userId !== undefined &&
    payload.userId !== messageUserId
  ) {
    throw new Error(
      `Invalid ${jobType} payload: userId: is not the message's userId`,
    );
  }

  return { jobType, userId: messageUserId, payload };
}
