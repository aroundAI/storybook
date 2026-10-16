import 'server-only';

import { metaFetch } from '@kit/shared/vendors';

import {
  type CommentFetch,
  type CommentFetchOptions,
  clipCommentText,
} from '../../lib/audience-comments/fetched';
import { readMetaCommentPages } from '../../lib/audience-comments/meta-paging';

/**
 * FILM-1733. A Page video's top-level comments, newest first. Needs
 * `pages_read_user_content`, which waits on its own App Review (the
 * `meta_comments` switch).
 * https://developers.facebook.com/docs/graph-api/reference/object/comments/
 */

interface FacebookComment {
  id: string;
  message?: string;
  created_time?: string;
  like_count?: number;
  comment_count?: number;
}

export function fetchFacebookComments(
  accessToken: string,
  videoId: string,
  options: CommentFetchOptions,
): Promise<CommentFetch> {
  return readMetaCommentPages<FacebookComment>(
    'facebook',
    videoId,
    (after) =>
      metaFetch(
        `/${videoId}/comments?fields=id,message,created_time,like_count,comment_count&filter=toplevel&order=reverse_chronological&limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`,
        { token: accessToken },
      ),
    (item) =>
      item.created_time
        ? {
            platformCommentId: item.id,
            parentPlatformCommentId: null,
            text: clipCommentText(item.message ?? ''),
            likeCount: item.like_count ?? 0,
            replyCount: item.comment_count ?? null,
            commentedAt: item.created_time,
          }
        : null,
    options,
  );
}
