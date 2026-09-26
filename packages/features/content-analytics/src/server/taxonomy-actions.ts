'use server';

import type { SupabaseClient } from '@supabase/supabase-js';

import { z } from 'zod';

import { querySegmentPerformance } from '@kit/clickhouse/server';
import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import { returnRefusals } from '@kit/next/refusals';
import { fetchAllByIds, fetchAllRows } from '@kit/shared/pagination';
import type { Database } from '@kit/supabase/database';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  BulkTagPublishesSchema,
  CreateTagSchema,
  DeleteTagSchema,
  ListTagsSchema,
  SetPublishTagsSchema,
  TAGGED_LIBRARY_THRESHOLD,
  TagDimensionSchema,
  UpdateTagSchema,
} from '../lib/schemas/taxonomy.schema';
import { tagScopeRefusal } from '../lib/tag-scope';
import { resolveTagMinSample } from '../lib/ypp-targets';
import { upsertVideoDims } from './dim-sync';
import { assertScopeAccess } from './scope-access';
import { fetchAccountAnalyticsSettings } from './settings-queries';

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

export const updateTagAction = enhanceAction(
  async ({ tagId, label }) => {
    const client = getSupabaseServerClient();

    const { error } = await client
      .from('content_tags')
      .update({ label })
      .eq('id', tagId);

    if (error) {
      throw new Error(`Failed to update tag: ${error.message}`);
    }

    return { success: true };
  },
  { schema: UpdateTagSchema, auth: true },
);

/**
 * Deleting a tag cascades to its assignments; affected publishes are
 * re-synced so video_dim.tags stops advertising it.
 */
export const deleteTagAction = enhanceAction(
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

    const { error } = await client
      .from('content_tags')
      .delete()
      .eq('id', tagId);

    if (error) {
      throw new Error(`Failed to delete tag: ${error.message}`);
    }

    const publishIds = assignments.map((row) => row.publish_id);

    if (publishIds.length > 0) {
      await upsertVideoDims(publishIds);
    }

    return { success: true };
  },
  { schema: DeleteTagSchema, auth: true },
);

export const listTagsAction = enhanceAction(
  async ({ accountId, dimension }) => {
    const client = getSupabaseServerClient();

    let query = client
      .from('content_tags')
      .select('id, dimension, slug, label')
      .eq('account_id', accountId)
      .order('dimension')
      .order('label');

    if (dimension) {
      query = query.eq('dimension', dimension);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to list tags: ${error.message}`);
    }

    return data ?? [];
  },
  { schema: ListTagsSchema, auth: true },
);

/**
 * Refuses tags from another account than the videos' (KB-98), before any
 * existing tag is cleared. Read through the caller's client, so RLS decides
 * what is visible and the rule in `tagScopeRefusal` decides the rest.
 */
async function assertTagsInPublishAccount(
  client: SupabaseClient<Database>,
  publishIds: string[],
  tagIds: string[],
): Promise<void> {
  const publishes = await fetchAllByIds<{
    id: string;
    episodes: { projects: { account_id: string } };
  }>(
    publishIds,
    (chunk, from, to) =>
      client
        .from('publishes')
        .select('id, episodes!inner(projects!inner(account_id))')
        .in('id', chunk)
        .order('id')
        .range(from, to),
    'publishes to tag',
  );

  const tags = await fetchAllByIds<{ id: string; account_id: string }>(
    tagIds,
    (chunk, from, to) =>
      client
        .from('content_tags')
        .select('id, account_id')
        .in('id', chunk)
        .order('id')
        .range(from, to),
    'tags to assign',
  );

  const refusal = tagScopeRefusal({
    publishIds,
    tagIds,
    publishAccounts: new Map(
      publishes.map((row) => [row.id, row.episodes.projects.account_id]),
    ),
    tagAccounts: new Map(tags.map((row) => [row.id, row.account_id])),
  });

  if (refusal) {
    throw new ActionRefusal(refusal);
  }
}

/**
 * Replaces the full tag set on one publish.
 */
const setPublishTags = enhanceAction(
  async ({ publishId, tagIds }) => {
    const client = getSupabaseServerClient();

    await assertTagsInPublishAccount(client, [publishId], tagIds);

    const { error: deleteError } = await client
      .from('publish_tags')
      .delete()
      .eq('publish_id', publishId);

    if (deleteError) {
      throw new Error(`Failed to clear tags: ${deleteError.message}`);
    }

    if (tagIds.length > 0) {
      const { error: insertError } = await client
        .from('publish_tags')
        .insert(
          tagIds.map((tagId) => ({ publish_id: publishId, tag_id: tagId })),
        );

      if (insertError) {
        throw new Error(`Failed to assign tags: ${insertError.message}`);
      }
    }

    await upsertVideoDims([publishId]);

    return { success: true, tagCount: tagIds.length };
  },
  { schema: SetPublishTagsSchema, auth: true },
);

export const setPublishTagsAction = returnRefusals(setPublishTags);

/**
 * Applies tags across many publishes — the backfill path for tagging an
 * existing library.
 */
const bulkTagPublishes = enhanceAction(
  async ({ publishIds, tagIds, replace }) => {
    const client = getSupabaseServerClient();

    await assertTagsInPublishAccount(client, publishIds, tagIds);

    if (replace) {
      const { error } = await client
        .from('publish_tags')
        .delete()
        .in('publish_id', publishIds);

      if (error) {
        throw new Error(`Failed to clear tags: ${error.message}`);
      }
    }

    const rows = publishIds.flatMap((publishId) =>
      tagIds.map((tagId) => ({ publish_id: publishId, tag_id: tagId })),
    );

    const { error } = await client.from('publish_tags').upsert(rows, {
      onConflict: 'publish_id,tag_id',
      ignoreDuplicates: true,
    });

    if (error) {
      throw new Error(`Failed to assign tags: ${error.message}`);
    }

    await upsertVideoDims(publishIds);

    return { success: true, publishCount: publishIds.length };
  },
  { schema: BulkTagPublishesSchema, auth: true },
);

export const bulkTagPublishesAction = returnRefusals(bulkTagPublishes);

/**
 * Tags currently assigned to a set of publishes, for the content table
 * and the tag picker.
 */
export const getPublishTagsAction = enhanceAction(
  async ({ publishIds }) => {
    const client = getSupabaseServerClient();

    // Chunked and paged. publishIds is capped at 500 by the schema, but
    // publish_tags is one row per assignment — 500 publishes with a handful
    // of tags each exceeds the row cap, and the picker would show videos as
    // untagged when they are not.
    const data = await fetchAllByIds<{
      publish_id: string;
      content_tags: unknown;
    }>(
      publishIds,
      (chunk, from, to) =>
        client
          .from('publish_tags')
          .select('publish_id, content_tags!inner(id, dimension, slug, label)')
          .in('publish_id', chunk)
          .order('publish_id')
          .order('tag_id')
          .range(from, to),
      'publish tags',
    );

    const byPublish: Record<
      string,
      Array<{ id: string; dimension: string; slug: string; label: string }>
    > = {};

    for (const row of data) {
      const tag = row.content_tags as unknown as {
        id: string;
        dimension: string;
        slug: string;
        label: string;
      };
      if (!tag) continue;
      byPublish[row.publish_id] = [...(byPublish[row.publish_id] ?? []), tag];
    }

    return byPublish;
  },
  {
    schema: z.object({
      publishIds: z.array(z.string().uuid()).min(1).max(500),
    }),
    auth: true,
  },
);

/**
 * Median performance grouped by taxonomy tag — the analysis that
 * separates repeatable format effects from single-video luck. Gated until
 * the account has tagged enough videos for the comparison to mean
 * anything.
 *
 * Figures are bounded to a checkpoint age (default 30 days) rather than
 * summed over a lifetime, so a tag applied mostly to older uploads no
 * longer wins on nothing but time. This changes every number the card
 * shows, and that is the point (FILM-1606).
 */
export const getMedianByTagAction = enhanceAction(
  async ({ accountId, projectId, dimension, checkpointDays }) => {
    const scope = projectId ? { projectId } : { accountId };

    // ClickHouse is outside Postgres RLS. This action previously took
    // accountId and projectId as user input and queried on them with no
    // ownership check at all.
    //
    // The *resolved* account is what the reads below use. Validating the
    // scope alone is not enough: with a project the caller owns and an
    // accountId they cannot see, RLS would return no rows rather than
    // raise, and the gate would report "tag medians unlock at 30 videos"
    // for a fully tagged library — a silent wrong answer.
    // No `?? accountId` fallback: that is the unvalidated input this whole
    // comment exists to reject, and reverting to it silently would undo
    // the check. projects.account_id is NOT NULL, so the resolve cannot
    // fail for a project scope, and the account branch returns the id it
    // verified — an absence here means an assumption broke, and failing is
    // the right answer.
    const resolvedAccountId = await assertScopeAccess(scope);

    if (!resolvedAccountId) {
      throw new Error('Scope resolved to no account');
    }

    const client = getSupabaseServerClient();

    // Counts DISTINCT tagged videos. A row count over publish_tags counts
    // assignments, so one video carrying four tags would advance the gate
    // by four.
    const [settings, { data: taggedCount }] = await Promise.all([
      fetchAccountAnalyticsSettings(resolvedAccountId, client),
      client.rpc('count_tagged_publishes', {
        target_account_id: resolvedAccountId,
      }),
    ]);

    if ((taggedCount ?? 0) < TAGGED_LIBRARY_THRESHOLD) {
      return {
        insufficientSample: true as const,
        taggedCount: taggedCount ?? 0,
        required: TAGGED_LIBRARY_THRESHOLD,
        rows: [],
      };
    }

    const rows = await querySegmentPerformance({
      scope,
      segment: { kind: 'tag', dimension },
      // `?? 5` until FILM-1608. The literal defaults now live in
      // ANALYTICS_DEFAULTS beside the YPP ones, because the two readers of
      // this table had already drifted into resolving an unset value
      // differently from each other.
      minVideos: resolveTagMinSample(settings),
      checkpointDays,
    });

    return { insufficientSample: false as const, rows };
  },
  {
    schema: z.object({
      accountId: z.string().uuid(),
      projectId: z.string().uuid().optional(),
      dimension: TagDimensionSchema,
      checkpointDays: z.number().int().min(1).max(730).default(30),
    }),
    auth: true,
  },
);
