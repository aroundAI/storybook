'use server';

import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import { requireAffectedRows, returnRefusals } from '@kit/next/refusals';
import { fetchAllRows } from '@kit/shared/pagination';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  BulkTagPublishesSchema,
  CreateTagSchema,
  DeleteTagSchema,
  ListTagsSchema,
  SetPublishTagsSchema,
} from '../lib/schemas/taxonomy.schema';
import { upsertVideoDims } from './dim-sync';
import {
  GetMedianByTagSchema,
  GetPublishTagsSchema,
  bulkTagPublishesService,
  getMedianByTagService,
  getPublishTagsService,
  listTagsService,
  setPublishTagsService,
} from './taxonomy-service';

const createTag = enhanceAction(
  async (data, user) => {
    const client = getSupabaseServerClient();

    const { data: tag, error } = await client
      .from('content_tags')
      .insert({
        account_id: data.accountId,
        dimension: data.dimension,
        slug: data.slug,
        label: data.label,
        created_by: user.id,
      })
      .select('id, dimension, slug, label')
      .single();

    if (error) {
      // unique (account_id, dimension, slug): the one failure a user causes.
      if (error.code === '23505') {
        throw new ActionRefusal(
          'A tag with this label already exists in this dimension.',
        );
      }

      throw new Error(`Failed to create tag: ${error.message}`);
    }

    return tag;
  },
  { schema: CreateTagSchema, auth: true },
);

export const createTagAction = returnRefusals(createTag);

/**
 * Deleting a tag cascades to its assignments; affected publishes are
 * re-synced so video_dim.tags stops advertising it.
 */
const deleteTag = enhanceAction(
  async ({ tagId }) => {
    const client = getSupabaseServerClient();

    // Paged before the delete. Any assignment missed here keeps advertising
    // the tag in video_dim forever — the row is gone from Postgres, so no
    // later pass can rediscover which publishes need re-syncing.
    const assignments = await fetchAllRows<{ publish_id: string }>(
      (from, to) =>
        client
          .from('publish_tags')
          .select('publish_id')
          .eq('tag_id', tagId)
          .order('publish_id')
          .range(from, to),
      'publish_tags by tag',
    );

    const { data: deleted, error } = await client
      .from('content_tags')
      .delete()
      .eq('id', tagId)
      .select('id');

    if (error) {
      throw new Error(`Failed to delete tag: ${error.message}`);
    }

    requireAffectedRows(deleted, "That tag wasn't deleted.");

    const publishIds = assignments.map((row) => row.publish_id);

    if (publishIds.length > 0) {
      await upsertVideoDims(publishIds);
    }

    return { success: true };
  },
  { schema: DeleteTagSchema, auth: true },
);

export const deleteTagAction = returnRefusals(deleteTag);

/**
 * The account's tags: the cookie-session wrapper over `listTagsService`
 * (FILM-1906).
 */
export const listTagsAction = enhanceAction(
  async (data) => listTagsService(getSupabaseServerClient(), data),
  { schema: ListTagsSchema, auth: true },
);

/**
 * Replaces the full tag set on one publish: the wrapper over
 * `setPublishTagsService` (FILM-1906).
 */
const setPublishTags = enhanceAction(
  async (data) => setPublishTagsService(getSupabaseServerClient(), data),
  { schema: SetPublishTagsSchema, auth: true },
);

export const setPublishTagsAction = returnRefusals(setPublishTags);

/**
 * Applies tags across many publishes — the backfill path for tagging an
 * existing library: the wrapper over `bulkTagPublishesService` (FILM-1906).
 */
const bulkTagPublishes = enhanceAction(
  async (data) => bulkTagPublishesService(getSupabaseServerClient(), data),
  { schema: BulkTagPublishesSchema, auth: true },
);

export const bulkTagPublishesAction = returnRefusals(bulkTagPublishes);

/**
 * Tags currently assigned to a set of publishes, for the content table
 * and the tag picker: the wrapper over `getPublishTagsService` (FILM-1906).
 */
export const getPublishTagsAction = enhanceAction(
  async (data) => getPublishTagsService(getSupabaseServerClient(), data),
  {
    schema: GetPublishTagsSchema,
    auth: true,
  },
);

/**
 * Median performance grouped by taxonomy tag (FILM-1606): the wrapper over
 * `getMedianByTagService` (FILM-1906), which proves the scope first.
 */
export const getMedianByTagAction = enhanceAction(
  async (data) => getMedianByTagService(getSupabaseServerClient(), data),
  {
    schema: GetMedianByTagSchema,
    auth: true,
  },
);
