import 'server-only';

import { metaFetch } from '@kit/shared/vendors';

import {
  type CommentFetch,
  type CommentFetchOptions,
  clipCommentText,
} from '../../lib/audience-comments/fetched';
import { readMetaCommentPages } from '../../lib/audience-comments/meta-paging';

/**
 * FILM-1733. A Reel's top-level comments. Needs `instagram_manage_comments`
 * on the Facebook Login path, which waits on its own App Review (the
 * `meta_comments` switch). Replies are not read, so a comment's reply count
 * is not reported; Instagram does not document the edge's order, so every
 * read is a full one.
 * https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-media/comments
 */

interface InstagramComment {
  id: string;
  text?: string;
  timestamp?: string;
  like_count?: number;
}

export function fetchInstagramComments(
  accessToken: string,
  mediaId: string,
  options: CommentFetchOptions,
): Promise<CommentFetch> {
  return readMetaCommentPages<InstagramComment>(
    'instagram',
    mediaId,
    (after) =>
      metaFetch(
        `/${mediaId}/comments?fields=id,text,timestamp,like_count&limit=50${after ? `&after=${encodeURIComponent(after)}` : ''}`,
        { token: accessToken },
      ),
    (item) =>
      item.timestamp
        ? {
            platformCommentId: item.id,
            parentPlatformCommentId: null,
            text: clipCommentText(item.text ?? ''),
            likeCount: item.like_count ?? 0,
            replyCount: null,
            commentedAt: item.timestamp,
          }
        : null,
    options,
  );
}
