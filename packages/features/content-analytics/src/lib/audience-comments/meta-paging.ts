import { platformLabel } from '../platform-labels';
import {
  type CommentFetch,
  type CommentFetchOptions,
  CommentScopeError,
  CommentVideoGoneError,
  type FetchedComment,
} from './fetched';

/**
 * FILM-1733. Paging a Meta comment edge: Instagram's and Facebook's differ
 * in fields, not in paging or errors. Each provider makes its own request
 * (so its URL is checked where it is written), and hands this the page.
 */

interface MetaPage<T> {
  data?: T[];
  paging?: { cursors?: { after?: string }; next?: string };
  error?: { message?: string; code?: number; error_subcode?: number };
}

/** Graph error codes that mean the token lacks a permission */
const PERMISSION_CODES = new Set([10, 200, 190]);

export async function readMetaCommentPages<T>(
  platform: 'instagram' | 'facebook',
  objectId: string,
  fetchPage: (after: string | undefined) => Promise<Response>,
  toComment: (item: T) => FetchedComment | null,
  options: CommentFetchOptions,
): Promise<CommentFetch> {
  const comments: FetchedComment[] = [];
  let after: string | undefined;

  for (let page = 0; page < options.maxPages; page++) {
    const response = await fetchPage(after);
    const body = (await response.json().catch(() => ({}))) as MetaPage<T>;

    if (!response.ok || body.error) {
      const code = body.error?.code;

      if (code === 100 && body.error?.error_subcode === 33) {
        throw new CommentVideoGoneError(platform, objectId);
      }

      if ((code && PERMISSION_CODES.has(code)) || response.status === 403) {
        throw new CommentScopeError(
          platform,
          body.error?.message ?? `HTTP ${response.status}`,
        );
      }

      throw new Error(
        `${platformLabel(platform)} comments: ${body.error?.message ?? `HTTP ${response.status}`}`,
      );
    }

    for (const item of body.data ?? []) {
      const comment = toComment(item);
      if (!comment) continue;

      if (options.since && new Date(comment.commentedAt) < options.since) {
        return { comments, complete: false };
      }

      comments.push(comment);
    }

    after = body.paging?.next ? body.paging.cursors?.after : undefined;
    if (!after) return { comments, complete: true };
  }

  return { comments, complete: false };
}
