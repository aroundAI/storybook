import { platformLabel } from '../platform-labels';

/**
 * FILM-1733. A comment as a platform returned it, before it is stored.
 * No author name or id: nothing here identifies the commenter.
 */
export interface FetchedComment {
  platformCommentId: string;
  /** The thread's top comment, for a reply */
  parentPlatformCommentId: string | null;
  text: string;
  likeCount: number;
  /** Null when the platform does not report it */
  replyCount: number | null;
  commentedAt: string;
}

export interface CommentFetch {
  comments: FetchedComment[];
  /**
   * Every comment the platform holds was read. Only then may comments that
   * did not come back be taken as deleted.
   */
  complete: boolean;
}

export interface CommentFetchOptions {
  /** Read newest first, and stop at the first comment before this */
  since?: Date;
  /** At most this many pages */
  maxPages: number;
}

/** The platform refused for want of a permission: reconnect, or wait for review */
export class CommentScopeError extends Error {
  constructor(platform: string, detail: string) {
    super(`${platformLabel(platform)} refused to list comments: ${detail}`);
    this.name = 'CommentScopeError';
  }
}

/** The platform says this video no longer exists */
export class CommentVideoGoneError extends Error {
  constructor(platform: string, videoId: string) {
    super(`${platformLabel(platform)} no longer has video ${videoId}`);
    this.name = 'CommentVideoGoneError';
  }
}

/** Text over this length is cut: the column's limit */
export const MAX_COMMENT_LENGTH = 10_000;

export function clipCommentText(text: string) {
  return text.length > MAX_COMMENT_LENGTH
    ? text.slice(0, MAX_COMMENT_LENGTH)
    : text;
}
