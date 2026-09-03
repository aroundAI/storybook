'use server';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

/**
 * Shared response type for all batch generation actions.
 * Queued = successfully enqueued to SQS.
 * Failed = individual episodes that couldn't be queued (bad status, missing data, etc.)
 */
interface BatchQueueResult {
  success: true;
  queued: number;
  failed: Array<{ episodeId: string; error: string }>;
}

// ─── Schemas ────────────────────────────────────────────────────────────────

const BatchGenerateIdeasSchema = z.object({
  episodes: z.array(
    z.object({
      episodeId: z.string().uuid(),
      premise: z.string().min(1),
      numberOfIdeas: z.number().int().min(1).max(5).default(3),
    }),
  ),
});

const BatchGenerateStoriesSchema = z.object({
  episodes: z.array(
    z.object({
      episodeId: z.string().uuid(),
      version: z.number().int(),
      title: z.string().min(1),
      logline: z.string().min(1),
      targetDuration: z.number().optional(),
      contentStyle: z.string().optional(),
      themes: z.array(z.string()).optional(),
      hook: z.string().optional(),
      visualDirection: z.string().optional(),
    }),
  ),
});

const BatchConvertScreenplaysSchema = z.object({
  episodes: z.array(
    z.object({
      episodeId: z.string().uuid(),
      contentStyle: z.string().optional(),
      dialogueStyle: z.string().optional(),
    }),
  ),
});

const BatchGenerateShotsSchema = z.object({
  episodes: z.array(
    z.object({
      episodeId: z.string().uuid(),
    }),
  ),
});

// ─── Batch Ideation ─────────────────────────────────────────────────────────

/**
 * Batch-enqueue story ideation for multiple episodes in a single server call.
 * Replaces N sequential generateStoryIdeasAction calls with 1 call + N SQS messages.
 */
export const batchGenerateIdeasAction = enhanceAction(
  async (data): Promise<BatchQueueResult> => {
    const logger = await getLogger();
    const ctx = {
      name: 'episodes.batchGenerateIdeas',
      count: data.episodes.length,
    };

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);
    if (authError || !user) throw new Error('Authentication required');

    logger.info(ctx, `Batch queuing ${data.episodes.length} ideation jobs`);

    // Resolve account ID once
    const { data: membership } = await client
      .from('accounts_memberships')
      .select('account_id')
      .eq('user_id', user.id)
      .limit(1);

    let accountId = membership?.[0]?.account_id;
    if (!accountId) {
      const { data: personal } = await client
        .from('accounts')
        .select('id')
        .eq('primary_owner_user_id', user.id)
        .limit(1);
      accountId = personal?.[0]?.id ?? user.id;
    }

    const { queueLlmJob } = await import('@kit/prompt-engine/server');
    const failed: BatchQueueResult['failed'] = [];
    let queued = 0;

    for (const ep of data.episodes) {
      try {
        await queueLlmJob({
          jobType: 'story-ideation',
          userId: user.id,
          payload: {
            episodeId: ep.episodeId,
            premise: ep.premise,
            numberOfIdeas: ep.numberOfIdeas,
            accountId,
            userId: user.id,
          },
        });
        queued++;
      } catch (err) {
        failed.push({
          episodeId: ep.episodeId,
          error: err instanceof Error ? err.message : 'Queue failed',
        });
      }
    }

    logger.info(
      { ...ctx, queued, failed: failed.length },
      'Batch ideation complete',
    );
    return { success: true, queued, failed };
  },
  { schema: BatchGenerateIdeasSchema },
);

// ─── Batch Story Generation ─────────────────────────────────────────────────

/**
 * Batch-enqueue full story generation for multiple episodes.
 * Fetches all episodes in one query, validates each, batch-inserts generation_jobs.
 */
export const batchGenerateStoriesAction = enhanceAction(
  async (data): Promise<BatchQueueResult> => {
    const logger = await getLogger();
    const ctx = {
      name: 'episodes.batchGenerateStories',
      count: data.episodes.length,
    };

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);
    if (authError || !user) throw new Error('Authentication required');

    logger.info(
      ctx,
      `Batch queuing ${data.episodes.length} story generation jobs`,
    );

    const episodeIds = data.episodes.map((ep) => ep.episodeId);

    // Batch-fetch all episodes in one query
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: episodes } = await (client as any)
      .from('episodes')
      .select(
        'id, project_id, status, version, project:projects(id, account_id)',
      )
      .in('id', episodeIds)
      .is('deleted_at', null);

    const episodeMap = new Map(
      (episodes ?? []).map((ep: { id: string }) => [ep.id, ep]),
    );

    const { queueLlmJob } = await import('@kit/prompt-engine/server');
    const failed: BatchQueueResult['failed'] = [];
    const jobEntries: Array<Record<string, unknown>> = [];
    let queued = 0;

    for (const ep of data.episodes) {
      const episode = episodeMap.get(ep.episodeId) as
        | Record<string, unknown>
        | undefined;

      if (!episode) {
        failed.push({ episodeId: ep.episodeId, error: 'Episode not found' });
        continue;
      }

      if (episode.status !== 'draft' && episode.status !== 'story') {
        failed.push({
          episodeId: ep.episodeId,
          error: `Invalid status: ${episode.status}`,
        });
        continue;
      }

      const project = episode.project as { account_id?: string } | undefined;
      const accountId = project?.account_id;
      if (!accountId) {
        failed.push({ episodeId: ep.episodeId, error: 'No account found' });
        continue;
      }

      jobEntries.push({
        reference_type: 'episode',
        reference_id: ep.episodeId,
        job_type: 'story',
        status: 'queued',
        account_id: accountId,
        project_id: episode.project_id,
        idempotency_key: `story-${ep.episodeId}-${Date.now()}`,
        input_data: { episodeId: ep.episodeId, title: ep.title },
      });

      try {
        await queueLlmJob({
          jobType: 'story-generation',
          userId: user.id,
          payload: {
            episodeId: ep.episodeId,
            title: ep.title,
            logline: ep.logline,
            targetDuration: ep.targetDuration,
            contentStyle: ep.contentStyle,
            version: ep.version,
            accountId,
            userId: user.id,
            projectId: episode.project_id as string,
            themes: ep.themes,
            hook: ep.hook,
            visualDirection: ep.visualDirection,
          },
        });
        queued++;
      } catch (err) {
        failed.push({
          episodeId: ep.episodeId,
          error: err instanceof Error ? err.message : 'Queue failed',
        });
      }
    }

    // Batch-insert generation job entries (non-blocking)
    if (jobEntries.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: jobError } = await (client as any)
        .from('generation_jobs')
        .insert(jobEntries);
      if (jobError) {
        logger.warn(
          { ...ctx, error: jobError },
          'Failed to batch-create generation jobs',
        );
      }
    }

    logger.info(
      { ...ctx, queued, failed: failed.length },
      'Batch story generation complete',
    );
    return { success: true, queued, failed };
  },
  { schema: BatchGenerateStoriesSchema },
);

// ─── Batch Screenplay Conversion ────────────────────────────────────────────

/**
 * Batch-enqueue screenplay conversion for multiple episodes.
 */
export const batchConvertScreenplaysAction = enhanceAction(
  async (data): Promise<BatchQueueResult> => {
    const logger = await getLogger();
    const ctx = {
      name: 'episodes.batchConvertScreenplays',
      count: data.episodes.length,
    };

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);
    if (authError || !user) throw new Error('Authentication required');

    logger.info(ctx, `Batch queuing ${data.episodes.length} screenplay jobs`);

    const episodeIds = data.episodes.map((ep) => ep.episodeId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: episodes } = await (client as any)
      .from('episodes')
      .select(
        'id, project_id, status, version, story_data, project:projects(id, account_id)',
      )
      .in('id', episodeIds)
      .is('deleted_at', null);

    const episodeMap = new Map(
      (episodes ?? []).map((ep: { id: string }) => [ep.id, ep]),
    );

    const { queueLlmJob } = await import('@kit/prompt-engine/server');
    const failed: BatchQueueResult['failed'] = [];
    const jobEntries: Array<Record<string, unknown>> = [];
    let queued = 0;

    for (const ep of data.episodes) {
      const episode = episodeMap.get(ep.episodeId) as
        | Record<string, unknown>
        | undefined;

      if (!episode) {
        failed.push({ episodeId: ep.episodeId, error: 'Episode not found' });
        continue;
      }

      if (episode.status !== 'story') {
        failed.push({
          episodeId: ep.episodeId,
          error: `Invalid status: ${episode.status}. Expected 'story'`,
        });
        continue;
      }

      const storyData = episode.story_data as { fullStory?: string } | null;
      if (!storyData?.fullStory) {
        failed.push({ episodeId: ep.episodeId, error: 'Missing story data' });
        continue;
      }

      const project = episode.project as { account_id?: string } | undefined;
      const accountId = project?.account_id;
      if (!accountId) {
        failed.push({ episodeId: ep.episodeId, error: 'No account found' });
        continue;
      }

      jobEntries.push({
        reference_type: 'episode',
        reference_id: ep.episodeId,
        job_type: 'screenplay',
        status: 'queued',
        account_id: accountId,
        project_id: episode.project_id,
        idempotency_key: `screenplay-${ep.episodeId}-${Date.now()}`,
        input_data: { episodeId: ep.episodeId },
      });

      try {
        await queueLlmJob({
          jobType: 'screenplay-conversion',
          userId: user.id,
          payload: {
            episodeId: ep.episodeId,
            dialogueStyle: ep.dialogueStyle,
            contentStyle: ep.contentStyle,
            version: episode.version as number,
            accountId,
            userId: user.id,
            projectId: episode.project_id as string,
          },
        });
        queued++;
      } catch (err) {
        failed.push({
          episodeId: ep.episodeId,
          error: err instanceof Error ? err.message : 'Queue failed',
        });
      }
    }

    if (jobEntries.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: jobError } = await (client as any)
        .from('generation_jobs')
        .insert(jobEntries);
      if (jobError) {
        logger.warn(
          { ...ctx, error: jobError },
          'Failed to batch-create generation jobs',
        );
      }
    }

    logger.info(
      { ...ctx, queued, failed: failed.length },
      'Batch screenplay conversion complete',
    );
    return { success: true, queued, failed };
  },
  { schema: BatchConvertScreenplaysSchema },
);

// ─── Batch Shot Generation ──────────────────────────────────────────────────

/**
 * Batch-enqueue shot list generation for multiple episodes.
 * Validates each episode has screenplay data before queuing.
 */
export const batchGenerateShotsAction = enhanceAction(
  async (data): Promise<BatchQueueResult> => {
    const logger = await getLogger();
    const ctx = {
      name: 'episodes.batchGenerateShots',
      count: data.episodes.length,
    };

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);
    if (authError || !user) throw new Error('Authentication required');

    logger.info(
      ctx,
      `Batch queuing ${data.episodes.length} shot generation jobs`,
    );

    const episodeIds = data.episodes.map((ep) => ep.episodeId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: episodes } = await (client as any)
      .from('episodes')
      .select(
        'id, project_id, version, screenplay_data, project:projects(id, account_id)',
      )
      .in('id', episodeIds)
      .is('deleted_at', null);

    const episodeMap = new Map(
      (episodes ?? []).map((ep: { id: string }) => [ep.id, ep]),
    );

    const { queueLlmJob } = await import('@kit/prompt-engine/server');
    const failed: BatchQueueResult['failed'] = [];
    const jobEntries: Array<Record<string, unknown>> = [];
    let queued = 0;

    for (const ep of data.episodes) {
      const episode = episodeMap.get(ep.episodeId) as
        | Record<string, unknown>
        | undefined;

      if (!episode) {
        failed.push({ episodeId: ep.episodeId, error: 'Episode not found' });
        continue;
      }

      const screenplayData = episode.screenplay_data as {
        scenes?: unknown[];
      } | null;
      if (!screenplayData?.scenes?.length) {
        failed.push({ episodeId: ep.episodeId, error: 'No screenplay scenes' });
        continue;
      }

      const project = episode.project as { account_id?: string } | undefined;
      const accountId = project?.account_id ?? 'unknown';

      jobEntries.push({
        reference_type: 'episode',
        reference_id: ep.episodeId,
        job_type: 'shot_list',
        status: 'queued',
        account_id: accountId,
        project_id: episode.project_id,
        idempotency_key: `shots-${ep.episodeId}-${Date.now()}`,
        input_data: { episodeId: ep.episodeId },
      });

      try {
        await queueLlmJob({
          jobType: 'shot-generation',
          userId: user.id,
          payload: {
            episodeId: ep.episodeId,
            version: episode.version as number,
            accountId,
            userId: user.id,
            projectId: episode.project_id as string,
          },
        });
        queued++;
      } catch (err) {
        failed.push({
          episodeId: ep.episodeId,
          error: err instanceof Error ? err.message : 'Queue failed',
        });
      }
    }

    if (jobEntries.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: jobError } = await (client as any)
        .from('generation_jobs')
        .insert(jobEntries);
      if (jobError) {
        logger.warn(
          { ...ctx, error: jobError },
          'Failed to batch-create generation jobs',
        );
      }
    }

    logger.info(
      { ...ctx, queued, failed: failed.length },
      'Batch shot generation complete',
    );
    return { success: true, queued, failed };
  },
  { schema: BatchGenerateShotsSchema },
);

// ─── Batch Asset Creation ───────────────────────────────────────────────────

const BatchCreateAssetsSchema = z.object({
  projectId: z.string().uuid(),
  episodes: z.array(
    z.object({
      episodeId: z.string().uuid(),
    }),
  ),
});

/**
 * Batch-enqueue asset creation for multiple episodes.
 * Each episode gets its own SQS job that reads screenplay_data,
 * extracts character/location descriptions via LLM, creates assets,
 * and links them to the episode.
 */
export const batchCreateAssetsAction = enhanceAction(
  async (data): Promise<BatchQueueResult> => {
    const logger = await getLogger();
    const ctx = {
      name: 'episodes.batchCreateAssets',
      count: data.episodes.length,
    };

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);
    if (authError || !user) throw new Error('Authentication required');

    logger.info(
      ctx,
      `Batch queuing ${data.episodes.length} asset creation jobs`,
    );

    const episodeIds = data.episodes.map((ep) => ep.episodeId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: episodes } = await (client as any)
      .from('episodes')
      .select(
        'id, project_id, screenplay_data, project:projects(id, account_id)',
      )
      .in('id', episodeIds)
      .is('deleted_at', null);

    const episodeMap = new Map(
      (episodes ?? []).map((ep: { id: string }) => [ep.id, ep]),
    );

    const { queueLlmJob } = await import('@kit/prompt-engine/server');
    const failed: BatchQueueResult['failed'] = [];
    const jobEntries: Array<Record<string, unknown>> = [];
    let queued = 0;

    for (const ep of data.episodes) {
      const episode = episodeMap.get(ep.episodeId) as
        | Record<string, unknown>
        | undefined;

      if (!episode) {
        failed.push({ episodeId: ep.episodeId, error: 'Episode not found' });
        continue;
      }

      const screenplayData = episode.screenplay_data as {
        scenes?: unknown[];
        metadata?: unknown;
      } | null;
      if (!screenplayData?.scenes?.length && !screenplayData?.metadata) {
        failed.push({ episodeId: ep.episodeId, error: 'No screenplay data' });
        continue;
      }

      const project = episode.project as { account_id?: string } | undefined;
      const accountId = project?.account_id ?? 'unknown';

      jobEntries.push({
        reference_type: 'episode',
        reference_id: ep.episodeId,
        job_type: 'asset_creation',
        status: 'queued',
        account_id: accountId,
        project_id: data.projectId,
        idempotency_key: `assets-${ep.episodeId}-${Date.now()}`,
        input_data: { episodeId: ep.episodeId, projectId: data.projectId },
      });

      try {
        await queueLlmJob({
          jobType: 'asset-creation',
          userId: user.id,
          payload: {
            episodeId: ep.episodeId,
            projectId: data.projectId,
            accountId,
            userId: user.id,
          },
        });
        queued++;
      } catch (err) {
        failed.push({
          episodeId: ep.episodeId,
          error: err instanceof Error ? err.message : 'Queue failed',
        });
      }
    }

    if (jobEntries.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: jobError } = await (client as any)
        .from('generation_jobs')
        .insert(jobEntries);
      if (jobError) {
        logger.warn(
          { ...ctx, error: jobError },
          'Failed to batch-create generation jobs',
        );
      }
    }

    logger.info(
      { ...ctx, queued, failed: failed.length },
      'Batch asset creation complete',
    );
    return { success: true, queued, failed };
  },
  { schema: BatchCreateAssetsSchema },
);
