'use server';

import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

// ──────────────────────────────────────────
// Schemas
// ──────────────────────────────────────────

const EnqueueRenderSchema = z.object({
  editProjectId: z.string().uuid(),
  language: z.string().min(2).max(10).default('en'),
});

const EnqueueMultiLanguageRenderSchema = z.object({
  editProjectId: z.string().uuid(),
  languages: z.array(z.string().min(2).max(10)).min(1),
});

const GetRenderStatusSchema = z.object({
  editProjectId: z.string().uuid(),
});

// ──────────────────────────────────────────
// SQS helpers
// ──────────────────────────────────────────

const sqs = new SQSClient({});

function getRenderQueueUrl(): string {
  // Try SST Resource binding first (production)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Resource } = require('sst');
    if (Resource?.StorybookRenderQueue?.url) {
      return Resource.StorybookRenderQueue.url;
    }
  } catch {
    // Resource not available - not in SST environment
  }

  // Fall back to environment variable
  return process.env.RENDER_QUEUE_URL || '';
}

// ──────────────────────────────────────────
// Ownership verification
// ──────────────────────────────────────────

async function verifyEditProjectOwnership(
  editProjectId: string,
  userId: string,
) {
  const client = getSupabaseServerClient();

  // Verify: edit_project → episode → project → account → membership
  const { data: editProject, error } = await client
    .from('edit_projects')
    .select(
      'id, episode_id, episodes!inner(project_id, projects!inner(account_id))',
    )
    .eq('id', editProjectId)
    .single();

  if (error || !editProject) {
    throw new Error('Edit project not found');
  }

  const accountId = (
    editProject as unknown as {
      episodes: { projects: { account_id: string } };
    }
  ).episodes.projects.account_id;

  const { data: membership } = await client
    .from('accounts_memberships')
    .select('account_id')
    .eq('account_id', accountId)
    .eq('user_id', userId)
    .single();

  if (!membership) {
    throw new Error('Access denied: not a member of this account');
  }

  return editProject;
}

// ──────────────────────────────────────────
// Server Actions
// ──────────────────────────────────────────

/**
 * Enqueue a render job for a single language.
 * Sets render_status to 'queued' and sends SQS message.
 */
export const enqueueRenderAction = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = {
      name: 'editSuite.enqueueRender',
      editProjectId: data.editProjectId,
      language: data.language,
    };

    logger.info(ctx, 'Enqueuing render job');

    const auth = await requireUser(getSupabaseServerClient());
    if (!auth.data) throw new Error('Authentication required');
    const userId = auth.data.id;

    // Verify ownership
    await verifyEditProjectOwnership(data.editProjectId, userId);

    const queueUrl = getRenderQueueUrl();
    if (!queueUrl) {
      throw new Error(
        'RENDER_QUEUE_URL not configured. Ensure the render queue is linked in sst.config.ts',
      );
    }

    // Update status to 'queued'
    const client = getSupabaseServerClient();
    const { error: updateError } = await client
      .from('edit_projects')
      .update({
        render_status: 'queued',
        render_error: null,
        render_url: null,
      })
      .eq('id', data.editProjectId);

    if (updateError) {
      throw new Error(`Failed to update render status: ${updateError.message}`);
    }

    // Send SQS message
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({
          editProjectId: data.editProjectId,
          userId,
          language: data.language,
        }),
        MessageAttributes: {
          jobType: {
            DataType: 'String',
            StringValue: 'video-render',
          },
          language: {
            DataType: 'String',
            StringValue: data.language,
          },
        },
      }),
    );

    logger.info(ctx, 'Render job enqueued');

    revalidatePath(`/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]`, 'page');

    return { success: true, status: 'queued' as const };
  },
  { schema: EnqueueRenderSchema },
);

/**
 * Enqueue render jobs for multiple languages.
 * Creates a separate SQS message per language for parallel processing.
 */
export const enqueueMultiLanguageRenderAction = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = {
      name: 'editSuite.enqueueMultiLanguageRender',
      editProjectId: data.editProjectId,
      languages: data.languages,
    };

    logger.info(ctx, 'Enqueuing multi-language render jobs');

    const auth = await requireUser(getSupabaseServerClient());
    if (!auth.data) throw new Error('Authentication required');
    const userId = auth.data.id;

    // Verify ownership
    await verifyEditProjectOwnership(data.editProjectId, userId);

    const queueUrl = getRenderQueueUrl();
    if (!queueUrl) {
      throw new Error(
        'RENDER_QUEUE_URL not configured. Ensure the render queue is linked in sst.config.ts',
      );
    }

    // Update status to 'queued'
    const client = getSupabaseServerClient();
    const { error: updateError } = await client
      .from('edit_projects')
      .update({
        render_status: 'queued',
        render_error: null,
        render_url: null,
      })
      .eq('id', data.editProjectId);

    if (updateError) {
      throw new Error(`Failed to update render status: ${updateError.message}`);
    }

    // Queue separate jobs per language
    const results = await Promise.allSettled(
      data.languages.map((language) =>
        sqs.send(
          new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: JSON.stringify({
              editProjectId: data.editProjectId,
              userId,
              language,
            }),
            MessageAttributes: {
              jobType: {
                DataType: 'String',
                StringValue: 'video-render',
              },
              language: {
                DataType: 'String',
                StringValue: language,
              },
            },
          }),
        ),
      ),
    );

    const queued = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    logger.info(
      { ...ctx, queued, failed },
      'Multi-language render jobs enqueued',
    );

    revalidatePath(`/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]`, 'page');

    return {
      success: true,
      queued,
      failed,
      languages: data.languages,
    };
  },
  { schema: EnqueueMultiLanguageRenderSchema },
);

/**
 * Get render status for an edit project.
 * Fallback for when WebSocket is unavailable.
 */
export const getRenderStatusAction = enhanceAction(
  async (data) => {
    const auth = await requireUser(getSupabaseServerClient());
    if (!auth.data) throw new Error('Authentication required');

    await verifyEditProjectOwnership(data.editProjectId, auth.data.id);

    const client = getSupabaseServerClient();
    const { data: project, error } = await client
      .from('edit_projects')
      .select(
        'render_status, render_url, render_error, render_started_at, render_completed_at',
      )
      .eq('id', data.editProjectId)
      .single();

    if (error || !project) {
      throw new Error('Edit project not found');
    }

    return {
      success: true,
      status: project.render_status,
      renderUrl: project.render_url,
      renderError: project.render_error,
      renderStartedAt: project.render_started_at,
      renderCompletedAt: project.render_completed_at,
    };
  },
  { schema: GetRenderStatusSchema },
);
