'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  CommentScopeSchema,
  ListAudienceCommentsSchema,
} from '../lib/schemas/audience-comments.schema';
import {
  getCommentReactions,
  labelOf,
  listAudienceComments,
} from './audience-comments-service';
import { withRefusals } from './with-refusals';

/**
 * FILM-1733. The page's reads of audience comments: the cookie-session
 * wrappers over `audience-comments-service.ts`, whose reads run on the
 * caller's client so RLS decides whose comments are seen.
 */

function scopeOf(input: { projectId?: string; episodeId?: string }) {
  return input.projectId
    ? { projectId: input.projectId }
    : { episodeId: input.episodeId! };
}

/** How each video in a project or an episode was received */
export const getCommentReactionsAction = withRefusals(
  'load the audience reaction',
  enhanceAction(
    async (input) =>
      getCommentReactions(getSupabaseServerClient(), scopeOf(input)),
    { schema: CommentScopeSchema },
  ),
);

/** A page of comments, newest first, filtered by label */
export const listAudienceCommentsAction = withRefusals(
  'load the comments',
  enhanceAction(
    async (input) => {
      if (!!input.projectId === !!input.episodeId) {
        throw new Error('Name a project or an episode');
      }

      const page = await listAudienceComments(
        getSupabaseServerClient(),
        scopeOf(input),
        {
          sentiment: input.sentiment,
          topic: input.topic,
          unlabelled: input.unlabelled,
          limit: input.limit,
          after: input.after,
        },
      );

      return {
        comments: page.comments.map((comment) => ({
          id: comment.id,
          publishId: comment.publish_id,
          platform: comment.platform,
          videoTitle: comment.publishes.title,
          contentType: comment.publishes.content_type,
          text: comment.text,
          likeCount: comment.like_count,
          isReply: comment.parent_platform_comment_id !== null,
          commentedAt: comment.commented_at,
          label: labelOf(comment),
        })),
        next: page.next,
      };
    },
    { schema: ListAudienceCommentsSchema },
  ),
);
