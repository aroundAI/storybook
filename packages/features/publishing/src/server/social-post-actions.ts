'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { ActionRefusal } from '@kit/next/action-result';
import { checkRateLimit, enhanceAction } from '@kit/next/actions';
import { requireAffectedRows, returnRefusals } from '@kit/next/refusals';
import { getLogger } from '@kit/shared/logger';
import type { Json } from '@kit/supabase/database';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { createBraveSearchClient } from '../lib/research';
import {
  ApproveSocialPostSchema,
  CreateSocialPostSchema,
  DeleteSocialPostSchema,
  GetSocialPostSchema,
  GetSocialPostsSchema,
  PublishSocialPostSchema,
  RegenerateVariantsSchema,
  UpdateSocialPostSchema,
} from '../lib/schemas/social-post.schema';
import { createLinkedInProvider } from '../providers/linkedin';
import { assertConnectionOfAccount } from './connection-account';
import { getAccessToken } from './connection-tokens';

interface PostVariant {
  text?: string;
  hashtags?: string[];
}

/**
 * Generate LinkedIn post variants via prompt engine + LLM
 * Returns the generated variants array
 */
async function generatePostVariants(params: {
  rawNotes: string;
  researchSummary: string;
  tone?: string;
  authorContext?: string;
  accountId: string;
  userId?: string;
}): Promise<Array<Record<string, unknown>>> {
  const logger = await getLogger();

  const { executeLLM } = await import('@kit/prompt-engine/server');

  const result = await executeLLM<{ variants: Array<Record<string, unknown>> }>(
    {
      templateSlug: 'linkedin-post-generation',
      variables: {
        rawNotes: params.rawNotes,
        researchContext: params.researchSummary,
        variantCount: '3',
        authorContext:
          params.authorContext ??
          'A professional sharing insights on their area of expertise',
        tone: params.tone ?? 'Professional yet authentic, thought-provoking',
      },
      context: {
        name: 'socialPost.generateVariants',
        accountId: params.accountId,
        userId: params.userId,
      },
    },
  );

  const variants = result.data?.variants ?? [];

  logger.info(
    { variantCount: variants.length },
    'Post variants generated via prompt engine',
  );

  return variants;
}

/**
 * Create a new social post from raw notes
 * Performs research (if enabled) and generates LinkedIn post variants
 */
export const createSocialPostAction = enhanceAction(
  async (input, user) => {
    checkRateLimit(user.id, 'createSocialPost', {
      maxRequests: 5,
      windowMs: 60_000,
    });

    const logger = await getLogger();
    const ctx = { name: 'socialPost.create', accountId: input.accountId };
    logger.info(ctx, 'Creating social post from notes');

    const client = getSupabaseServerClient();

    // 1. Perform research if enabled
    let researchContext = {};
    let researchSummary = 'No additional research context available.';

    if (input.enableResearch) {
      try {
        const braveClient = createBraveSearchClient();
        const research = await braveClient.research(input.rawNotes);
        researchContext = research;
        researchSummary = research.summary;
        logger.info(
          { ...ctx, queryCount: research.queries.length },
          'Research completed',
        );
      } catch (error) {
        logger.warn(
          {
            ...ctx,
            error: error instanceof Error ? error.message : String(error),
          },
          'Research failed, continuing without research context',
        );
      }
    }

    // 2. Generate post variants using prompt engine
    let generatedVariants: Array<Record<string, unknown>> = [];
    try {
      generatedVariants = await generatePostVariants({
        rawNotes: input.rawNotes,
        researchSummary,
        tone: input.tone,
        authorContext: input.authorContext,
        accountId: input.accountId,
        userId: user.id,
      });
    } catch (error) {
      logger.error(
        {
          ...ctx,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to generate post variants',
      );
      throw new Error(
        `Failed to generate LinkedIn post variants: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }

    // 3. Create the social post record
    const firstVariant = generatedVariants[0] as PostVariant | undefined;

    const { data: post, error: insertError } = await client
      .from('social_posts')
      .insert({
        account_id: input.accountId,
        platform_connection_id: input.platformConnectionId ?? null,
        raw_notes: input.rawNotes,
        research_context: researchContext as unknown as Json,
        generated_variants: generatedVariants as unknown as Json,
        selected_variant_index: 0,
        final_text: firstVariant?.text ?? null,
        hashtags: firstVariant?.hashtags ?? [],
        status: generatedVariants.length > 0 ? 'ready_to_review' : 'draft',
        created_by: user.id,
      })
      .select()
      .single();

    if (insertError || !post) {
      logger.error(
        { ...ctx, error: insertError },
        'Failed to create social post',
      );
      throw new Error(`Failed to create social post: ${insertError?.message}`);
    }

    revalidatePath('/home/[account]/social-posts', 'page');

    return {
      postId: post.id,
      status: post.status,
      variantCount: generatedVariants.length,
    };
  },
  {
    schema: CreateSocialPostSchema,
    auth: true,
  },
);

/**
 * Get social posts for an account (with pagination)
 */
export const getSocialPostsAction = enhanceAction(
  async (input, _user) => {
    const client = getSupabaseServerClient();

    let query = client
      .from('social_posts')
      .select(
        'id, raw_notes, final_text, hashtags, platform, status, platform_url, created_at, updated_at, generated_variants, selected_variant_index, visibility',
        { count: 'exact' },
      )
      .eq('account_id', input.accountId)
      .order('created_at', { ascending: false })
      .range(input.offset, input.offset + input.limit - 1);

    if (input.status) {
      query = query.eq('status', input.status);
    }

    const { data: posts, error, count } = await query;

    if (error) {
      throw new Error(`Failed to fetch social posts: ${error.message}`);
    }

    return {
      posts: posts ?? [],
      total: count ?? 0,
    };
  },
  {
    schema: GetSocialPostsSchema,
    auth: true,
  },
);

/**
 * Get a single social post by ID
 */
export const getSocialPostAction = enhanceAction(
  async (input, _user) => {
    const client = getSupabaseServerClient();

    const { data: post, error } = await client
      .from('social_posts')
      .select(
        'id, account_id, platform_connection_id, raw_notes, research_context, generated_variants, selected_variant_index, final_text, hashtags, status, visibility, platform, platform_post_id, platform_url, published_at, metadata, created_by, created_at, updated_at',
      )
      .eq('id', input.postId)
      .single();

    if (error || !post) {
      throw new Error('Social post not found');
    }

    return post;
  },
  {
    schema: GetSocialPostSchema,
    auth: true,
  },
);

/**
 * Update a social post (edit text, pick variant, change settings)
 */
export const updateSocialPostAction = enhanceAction(
  async (input, _user) => {
    const client = getSupabaseServerClient();

    const updateData: Record<string, unknown> = {};

    if (input.finalText !== undefined) {
      updateData.final_text = input.finalText;
    }

    if (input.selectedVariantIndex !== undefined) {
      updateData.selected_variant_index = input.selectedVariantIndex;

      // Also update final_text from the selected variant
      const { data: post } = await client
        .from('social_posts')
        .select('generated_variants')
        .eq('id', input.postId)
        .single();

      if (post?.generated_variants) {
        const variants = post.generated_variants as PostVariant[];
        const selected = variants[input.selectedVariantIndex];
        if (selected?.text) {
          updateData.final_text = selected.text;
          if (selected.hashtags) {
            updateData.hashtags = selected.hashtags;
          }
        }
      }
    }

    if (input.hashtags !== undefined) {
      updateData.hashtags = input.hashtags;
    }
    if (input.visibility !== undefined) {
      updateData.visibility = input.visibility;
    }
    if (input.platformConnectionId !== undefined) {
      updateData.platform_connection_id = input.platformConnectionId;
    }

    const { data: updated, error } = await client
      .from('social_posts')
      .update(updateData)
      .eq('id', input.postId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update social post: ${error.message}`);
    }

    revalidatePath('/home/[account]/social-posts', 'page');
    return updated;
  },
  {
    schema: UpdateSocialPostSchema,
    auth: true,
  },
);

/**
 * Delete a social post (only non-published)
 */
const deleteSocialPost = enhanceAction(
  async (input, _user) => {
    const client = getSupabaseServerClient();

    const { data: deleted, error } = await client
      .from('social_posts')
      .delete()
      .eq('id', input.postId)
      .select('id');

    if (error) {
      throw new Error(`Failed to delete social post: ${error.message}`);
    }

    // RLS filters a refused delete to no rows, without an error (KB-61)
    requireAffectedRows(
      deleted,
      "The post wasn't deleted: it's already gone, or you can't delete it. Reload the page.",
    );

    revalidatePath('/home/[account]/social-posts', 'page');
    return { success: true };
  },
  {
    schema: DeleteSocialPostSchema,
    auth: true,
  },
);

export const deleteSocialPostAction = returnRefusals(deleteSocialPost);

/**
 * Approve a social post for publishing
 * Sets status to 'approved' and assigns a platform connection
 */
const approveSocialPost = enhanceAction(
  async (input, _user) => {
    const client = getSupabaseServerClient();

    // Verify the post exists and has content
    const { data: post, error: fetchError } = await client
      .from('social_posts')
      .select('final_text, status')
      .eq('id', input.postId)
      .single();

    if (fetchError || !post) {
      throw new ActionRefusal('Social post not found');
    }

    if (!post.final_text || post.final_text.trim().length === 0) {
      throw new ActionRefusal(
        'Cannot approve a post without content. Please generate or write post text first.',
      );
    }

    const { data: approved, error } = await client
      .from('social_posts')
      .update({
        status: 'approved',
        platform_connection_id: input.platformConnectionId,
      })
      .eq('id', input.postId)
      .select('id');

    if (error) {
      throw new Error(`Failed to approve social post: ${error.message}`);
    }

    requireAffectedRows(approved, "You can't approve this post.");

    revalidatePath('/home/[account]/social-posts', 'page');
    return { success: true };
  },
  {
    schema: ApproveSocialPostSchema,
    auth: true,
  },
);

export const approveSocialPostAction = returnRefusals(approveSocialPost);

/**
 * Publish a social post immediately
 * Posts to LinkedIn via the provider and updates status
 */
const publishSocialPostHandler = enhanceAction(
  async (input, _user) => {
    checkRateLimit(_user.id, 'publishSocialPost', {
      maxRequests: 5,
      windowMs: 60_000,
    });

    const logger = await getLogger();
    const ctx = { name: 'socialPost.publish', postId: input.postId };
    logger.info(ctx, 'Publishing social post');

    const client = getSupabaseServerClient();

    // Get the post
    const { data: post, error: fetchError } = await client
      .from('social_posts')
      .select(
        'id, account_id, final_text, platform_connection_id, visibility, metadata',
      )
      .eq('id', input.postId)
      .single();

    if (fetchError || !post) {
      throw new ActionRefusal('Social post not found');
    }

    if (!post.final_text) {
      throw new ActionRefusal('Post has no content to publish');
    }

    if (!post.platform_connection_id) {
      throw new ActionRefusal(
        'No LinkedIn connection selected. Please approve the post with a connection first.',
      );
    }

    // KB-109: the post's channel is one of the post's account, asked before
    // the token is decrypted
    await assertConnectionOfAccount(
      client,
      post.platform_connection_id,
      post.account_id,
    );

    // Update status to publishing. A publish RLS refuses changes no row: it
    // stops here, before the platform call, rather than posting anyway (KB-105).
    const { data: marked, error: markError } = await client
      .from('social_posts')
      .update({ status: 'publishing' })
      .eq('id', input.postId)
      .select('id');

    if (markError) {
      throw new Error(`Failed to start publishing: ${markError.message}`);
    }

    requireAffectedRows(marked, "You can't publish this post.");

    try {
      // Get access token
      const tokenResult = await getAccessToken(post.platform_connection_id);
      if (tokenResult.error || !tokenResult.accessToken) {
        throw new Error(tokenResult.error ?? 'Failed to get access token');
      }

      // Get the author URN from the platform connection
      const { data: connection } = await client
        .from('platform_connections')
        .select('platform_account_id')
        .eq('id', post.platform_connection_id)
        .single();

      if (!connection?.platform_account_id) {
        throw new Error('LinkedIn connection missing author URN');
      }

      // Create the text post
      const provider = createLinkedInProvider(tokenResult.accessToken);
      const result = await provider.createTextPost({
        text: post.final_text,
        visibility: (post.visibility as 'PUBLIC' | 'CONNECTIONS') ?? 'PUBLIC',
        authorUrn: connection.platform_account_id,
      });

      // Update with success
      await client
        .from('social_posts')
        .update({
          status: 'published',
          platform_post_id: result.postUrn,
          platform_url: result.postUrl,
          published_at: new Date().toISOString(),
        })
        .eq('id', input.postId);

      logger.info(
        { ...ctx, postUrn: result.postUrn, postUrl: result.postUrl },
        'Social post published successfully',
      );

      revalidatePath('/home/[account]/social-posts', 'page');

      return {
        success: true,
        postUrn: result.postUrn,
        postUrl: result.postUrl,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      // Update with failure
      await client
        .from('social_posts')
        .update({
          status: 'failed',
          metadata: {
            ...(post.metadata as object),
            error: errorMessage,
            failedAt: new Date().toISOString(),
          },
        })
        .eq('id', input.postId);

      logger.error(
        { ...ctx, error: errorMessage },
        'Social post publish failed',
      );
      throw error;
    }
  },
  {
    schema: PublishSocialPostSchema,
    auth: true,
  },
);

export const publishSocialPostAction = returnRefusals(publishSocialPostHandler);

/**
 * Regenerate variants for an existing post
 */
const regenerateVariantsHandler = enhanceAction(
  async (input, user) => {
    checkRateLimit(user.id, 'regenerateVariants', {
      maxRequests: 10,
      windowMs: 60_000,
    });

    const logger = await getLogger();
    const client = getSupabaseServerClient();

    // Get the post
    const { data: post, error: fetchError } = await client
      .from('social_posts')
      .select('raw_notes, research_context, account_id')
      .eq('id', input.postId)
      .single();

    if (fetchError || !post) {
      throw new ActionRefusal('Social post not found');
    }

    // Re-generate variants
    const researchContext = post.research_context as {
      summary?: string;
    } | null;
    const researchSummary =
      researchContext?.summary ?? 'No additional research context available.';

    let generatedVariants: Array<Record<string, unknown>> = [];
    try {
      generatedVariants = await generatePostVariants({
        rawNotes: post.raw_notes,
        researchSummary,
        tone: input.tone,
        authorContext: input.authorContext,
        accountId: post.account_id,
        userId: user.id,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to regenerate variants',
      );
      throw new Error('Failed to regenerate post variants');
    }

    const firstVariant = generatedVariants[0] as PostVariant | undefined;

    // Update the post
    const { data: _updated, error: updateError } = await client
      .from('social_posts')
      .update({
        generated_variants: generatedVariants as unknown as Json,
        selected_variant_index: 0,
        final_text: firstVariant?.text ?? null,
        hashtags: firstVariant?.hashtags ?? [],
        status: 'ready_to_review' as const,
      })
      .eq('id', input.postId)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Failed to update social post: ${updateError.message}`);
    }

    revalidatePath('/home/[account]/social-posts', 'page');

    return {
      postId: input.postId,
      variantCount: generatedVariants.length,
    };
  },
  {
    schema: RegenerateVariantsSchema,
    auth: true,
  },
);

export const regenerateVariantsAction = returnRefusals(
  regenerateVariantsHandler,
);
