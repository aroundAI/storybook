'use server';

import 'server-only';

import { getLogger } from '@kit/shared/logger';

import { generateMlaTasksAction } from './manual-task-actions';

/**
 * Post-publish hook that runs after a video is successfully published.
 * Checks for dubbed versions and creates MLA manual tasks.
 */
export async function runPostPublishHooks(params: {
  publishId: string;
  episodeId: string;
  platform: string;
  platformContentId: string;
}) {
  const logger = await getLogger();
  logger.info({ params }, 'Running post-publish hooks');

  // Only generate MLA tasks for YouTube publishes
  if (params.platform !== 'youtube') {
    logger.info({ platform: params.platform }, 'Skipping post-publish hooks for non-YouTube platform');
    return;
  }

  try {
    const result = await generateMlaTasksAction({
      publishId: params.publishId,
      episodeId: params.episodeId,
    });

    logger.info({ result }, 'Post-publish MLA task generation completed');
  } catch (error) {
    logger.error({ error, params }, 'Error running post-publish hooks for MLA');
    // We don't throw here to avoid failing the overall publish flow if the hook fails
  }
}
