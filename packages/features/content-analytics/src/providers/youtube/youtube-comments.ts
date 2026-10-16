import 'server-only';

import { google } from 'googleapis';

import { vendorUrl } from '@kit/shared/vendors';

import {
  type CommentFetch,
  type CommentFetchOptions,
  CommentScopeError,
  CommentVideoGoneError,
  type FetchedComment,
  clipCommentText,
} from '../../lib/audience-comments/fetched';

/**
 * FILM-1733. A video's comment threads from the YouTube Data API
 * (commentThreads.list, 1 quota unit per page of 100), newest first. Each
 * thread is its top comment and the replies YouTube includes with it.
 * https://developers.google.com/youtube/v3/docs/commentThreads/list
 */

function reasonOf(error: unknown): { status?: number; reason?: string } {
  const response = (
    error as {
      response?: {
        status?: number;
        data?: { error?: { errors?: Array<{ reason?: string }> } };
      };
    }
  )?.response;

  return {
    status: response?.status,
    reason: response?.data?.error?.errors?.[0]?.reason,
  };
}

export class YouTubeCommentsReader {
  private youtube;

  constructor(accessToken: string) {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    this.youtube = google.youtube({
      version: 'v3',
      auth,
      rootUrl: vendorUrl('youtube-data'),
    });
  }

  async read(
    videoId: string,
    options: CommentFetchOptions,
  ): Promise<CommentFetch> {
    const comments: FetchedComment[] = [];
    let pageToken: string | undefined;

    for (let page = 0; page < options.maxPages; page++) {
      let data;

      try {
        ({ data } = await this.youtube.commentThreads.list({
          part: ['snippet', 'replies'],
          videoId,
          maxResults: 100,
          order: 'time',
          textFormat: 'plainText',
          pageToken,
        }));
      } catch (error) {
        const { status, reason } = reasonOf(error);

        // Comments switched off on the video: there are none to read
        if (reason === 'commentsDisabled') return { comments, complete: true };

        if (status === 404 || reason === 'videoNotFound') {
          throw new CommentVideoGoneError('youtube', videoId);
        }

        if (
          reason === 'insufficientPermissions' ||
          reason === 'forbidden' ||
          status === 401
        ) {
          throw new CommentScopeError('youtube', reason ?? `HTTP ${status}`);
        }

        throw error;
      }

      for (const thread of data.items ?? []) {
        const top = thread.snippet?.topLevelComment;
        const snippet = top?.snippet;
        if (!top?.id || !snippet?.publishedAt) continue;

        if (options.since && new Date(snippet.publishedAt) < options.since) {
          return { comments, complete: false };
        }

        comments.push({
          platformCommentId: top.id,
          parentPlatformCommentId: null,
          text: clipCommentText(
            snippet.textOriginal ?? snippet.textDisplay ?? '',
          ),
          likeCount: snippet.likeCount ?? 0,
          replyCount: thread.snippet?.totalReplyCount ?? null,
          commentedAt: snippet.publishedAt,
        });

        for (const reply of thread.replies?.comments ?? []) {
          if (!reply.id || !reply.snippet?.publishedAt) continue;

          comments.push({
            platformCommentId: reply.id,
            parentPlatformCommentId: top.id,
            text: clipCommentText(
              reply.snippet.textOriginal ?? reply.snippet.textDisplay ?? '',
            ),
            likeCount: reply.snippet.likeCount ?? 0,
            replyCount: null,
            commentedAt: reply.snippet.publishedAt,
          });
        }
      }

      pageToken = data.nextPageToken ?? undefined;
      if (!pageToken) return { comments, complete: true };
    }

    return { comments, complete: false };
  }
}

export function fetchYouTubeComments(
  accessToken: string,
  videoId: string,
  options: CommentFetchOptions,
): Promise<CommentFetch> {
  return new YouTubeCommentsReader(accessToken).read(videoId, options);
}
