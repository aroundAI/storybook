'use client';

import { Fragment, useState } from 'react';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, MessageSquareText } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Skeleton } from '@kit/ui/skeleton';

import { unwrap } from '../../lib/action-result';
import {
  COMMENT_TOPICS,
  COMMENT_TOPIC_LABELS,
  type CommentSentiment,
  type CommentTopic,
} from '../../lib/audience-comments/labels';
import { platformLabel } from '../../lib/platform-labels';
import {
  getCommentReactionsAction,
  listAudienceCommentsAction,
} from '../../server/audience-comments-actions';
import type {
  CommentReactions,
  VideoReaction,
} from '../../server/audience-comments-service';
import {
  SENTIMENT_LABEL,
  SENTIMENT_ORDER,
  SentimentBar,
  SentimentSwatch,
  TopTopics,
  reactionStateText,
} from './reaction-parts';

/**
 * FILM-1733. What the audience says about a project's or an episode's
 * videos: the tone and topics of their labelled comments, for each video and
 * by the video's age, and the comments themselves, filtered by label.
 *
 * Descriptive only. YouTube figures carry the disclosure its policies ask
 * for (III.E.4.h).
 */

type Scope = { projectId: string } | { episodeId: string };

type Filter =
  | { kind: 'all' }
  | { kind: 'sentiment'; sentiment: CommentSentiment }
  | { kind: 'topic'; topic: CommentTopic }
  | { kind: 'unlabelled' };

export function AudienceCommentsSection({ scope }: { scope: Scope }) {
  const key = 'projectId' in scope ? scope.projectId : scope.episodeId;

  const reactions = useQuery({
    queryKey: ['comment-reactions', key],
    queryFn: () => unwrap(getCommentReactionsAction(scope)),
  });

  return (
    <section
      className="mt-6 flex flex-col gap-4 border-t pt-6"
      data-test="audience-comments"
    >
      <div className="flex flex-col gap-1">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <MessageSquareText className="h-4 w-4" />
          What the audience says
        </h3>
        <p className="text-sm text-muted-foreground">
          Comments are read hourly and labelled for tone and topic, by StoryBook
          or by your own AI through the MCP connector. Commenter names are not
          stored.
        </p>
      </div>

      {reactions.isLoading ? (
        <Skeleton className="h-40" />
      ) : reactions.isError || !reactions.data ? (
        <p
          className="text-sm text-muted-foreground"
          role="alert"
          data-test="audience-comments-error"
        >
          The audience comments could not be loaded.
        </p>
      ) : reactions.data.videos.length === 0 ? (
        <p
          className="text-sm text-muted-foreground"
          data-test="audience-comments-no-videos"
        >
          Nothing is published here yet.
        </p>
      ) : (
        <>
          <div
            className="flex flex-col gap-4"
            data-test="audience-comments-figures"
          >
            <Summary data={reactions.data} />
            <VideoTable videos={reactions.data.videos} />
          </div>
          {reactions.data.combined.videos > 0 && <CommentList scope={scope} />}
        </>
      )}
    </section>
  );
}

function Summary({
  data,
}: {
  data: Pick<CommentReactions, 'combined' | 'disclosure'>;
}) {
  const { combined, disclosure } = data;

  // No video's comments read yet: there are no figures, so no bar, no
  // "too few" and no disclosure, only why (the table says per video)
  if (combined.videos === 0) {
    return (
      <p
        className="rounded-md border p-4 text-sm text-muted-foreground"
        data-test="audience-comments-none-read"
      >
        No comments have been read for these videos yet.
      </p>
    );
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-md border p-4"
      data-test="audience-comments-summary"
    >
      <p className="text-sm">
        <span className="font-medium" data-test="audience-comments-count">
          {combined.comments}
        </span>{' '}
        comments on {combined.videos} video{combined.videos === 1 ? '' : 's'},{' '}
        <span data-test="audience-comments-labelled">{combined.labelled}</span>{' '}
        labelled
      </p>
      <SentimentBar shares={combined.shares} dataTest="summary-sentiment" />
      {combined.labelled > 0 && (
        <p className="text-sm">
          <span className="text-muted-foreground">Most talked about: </span>
          <TopTopics
            topics={combined.topics}
            labelled={combined.labelled}
            limit={4}
          />
        </p>
      )}
      {disclosure && (
        <p
          className="text-xs text-muted-foreground"
          data-test="audience-comments-disclosure"
        >
          {disclosure}
        </p>
      )}
    </div>
  );
}

function VideoTable({ videos }: { videos: VideoReaction[] }) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm" data-test="audience-comments-videos">
        <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            <th className="p-2 font-medium">Video</th>
            <th className="p-2 text-right font-medium">Comments</th>
            <th className="p-2 font-medium">Tone</th>
            <th className="p-2 font-medium">About</th>
          </tr>
        </thead>
        <tbody>
          {videos.map(({ publish, reaction }) => {
            const state = reactionStateText(reaction);
            const isOpen = open === publish.id;

            return (
              <Fragment key={publish.id}>
                <tr
                  className="border-t align-top"
                  data-test="audience-comments-video"
                  data-publish-id={publish.id}
                  data-state={reaction.kind}
                >
                  <td className="p-2">
                    <div className="flex items-start gap-1">
                      {reaction.kind === 'read' ? (
                        <button
                          type="button"
                          className="mt-0.5 text-muted-foreground"
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? 'Hide' : 'Show'} reaction by age`}
                          onClick={() => setOpen(isOpen ? null : publish.id)}
                          data-test="audience-comments-by-age-toggle"
                        >
                          {isOpen ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                      ) : (
                        <span className="w-4" />
                      )}
                      <div className="flex flex-col">
                        <span className="font-medium">
                          {publish.title ?? publish.episodeTitle ?? 'Untitled'}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {platformLabel(publish.platform)}
                          {publish.formatLabel
                            ? ` · ${publish.formatLabel}`
                            : ''}
                        </span>
                      </div>
                    </div>
                  </td>
                  {state ? (
                    <td
                      colSpan={3}
                      className="p-2 text-xs text-muted-foreground"
                      data-test="audience-comments-video-state"
                    >
                      {state}
                    </td>
                  ) : reaction.kind === 'read' ? (
                    <>
                      <td className="p-2 text-right tabular-nums">
                        {reaction.comments}
                        {reaction.unlabelled > 0 && (
                          <span className="block text-xs text-muted-foreground">
                            {reaction.unlabelled} unlabelled
                          </span>
                        )}
                      </td>
                      <td className="min-w-48 p-2">
                        <SentimentBar
                          shares={reaction.shares}
                          dataTest="video-sentiment"
                        />
                      </td>
                      <td className="p-2">
                        <TopTopics
                          topics={reaction.topics}
                          labelled={reaction.labelled}
                        />
                      </td>
                    </>
                  ) : null}
                </tr>
                {isOpen && reaction.kind === 'read' && (
                  <tr
                    className="bg-muted/20"
                    data-test="audience-comments-by-age"
                  >
                    <td colSpan={4} className="p-3">
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        {reaction.byAge.map((bucket) => (
                          <div
                            key={bucket.key}
                            className="flex flex-col gap-1"
                            data-test={`by-age-${bucket.key}`}
                          >
                            <span className="text-xs font-medium">
                              {bucket.label}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {bucket.comments} comments, {bucket.labelled}{' '}
                              labelled
                            </span>
                            {bucket.comments > 0 && (
                              <SentimentBar shares={bucket.shares} />
                            )}
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const FILTERS: Array<{ label: string; filter: Filter }> = [
  { label: 'All', filter: { kind: 'all' } },
  ...SENTIMENT_ORDER.map((sentiment) => ({
    label: SENTIMENT_LABEL[sentiment],
    filter: { kind: 'sentiment' as const, sentiment },
  })),
  { label: 'Unlabelled', filter: { kind: 'unlabelled' } },
];

function filterKey(filter: Filter) {
  switch (filter.kind) {
    case 'sentiment':
      return filter.sentiment;
    case 'topic':
      return `topic:${filter.topic}`;
    default:
      return filter.kind;
  }
}

function CommentList({ scope }: { scope: Scope }) {
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const key = 'projectId' in scope ? scope.projectId : scope.episodeId;

  const comments = useInfiniteQuery({
    queryKey: ['audience-comments', key, filterKey(filter)],
    initialPageParam: undefined as
      | { commentedAt: string; id: string }
      | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(
        listAudienceCommentsAction({
          ...scope,
          limit: 20,
          after: pageParam,
          ...(filter.kind === 'sentiment'
            ? { sentiment: filter.sentiment }
            : filter.kind === 'topic'
              ? { topic: filter.topic }
              : filter.kind === 'unlabelled'
                ? { unlabelled: true }
                : {}),
        }),
      ),
    getNextPageParam: (last) => last.next ?? undefined,
  });

  const rows = comments.data?.pages.flatMap((page) => page.comments) ?? [];

  return (
    <div className="flex flex-col gap-3" data-test="audience-comments-list">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(({ label, filter: option }) => (
          <Button
            key={filterKey(option)}
            size="sm"
            variant={
              filterKey(option) === filterKey(filter) ? 'default' : 'outline'
            }
            onClick={() => setFilter(option)}
            data-test={`comments-filter-${filterKey(option)}`}
          >
            {label}
          </Button>
        ))}
        <select
          className="h-8 rounded-md border bg-background px-2 text-sm"
          aria-label="Filter by topic"
          value={filter.kind === 'topic' ? filter.topic : ''}
          onChange={(event) =>
            setFilter(
              event.target.value
                ? { kind: 'topic', topic: event.target.value as CommentTopic }
                : { kind: 'all' },
            )
          }
          data-test="comments-filter-topic"
        >
          <option value="">Any topic</option>
          {COMMENT_TOPICS.map((topic) => (
            <option key={topic} value={topic}>
              {COMMENT_TOPIC_LABELS[topic]}
            </option>
          ))}
        </select>
      </div>

      {comments.isLoading ? (
        <Skeleton className="h-24" />
      ) : comments.isError ? (
        <p className="text-sm text-muted-foreground" role="alert">
          The comments could not be loaded.
        </p>
      ) : rows.length === 0 ? (
        <p
          className="text-sm text-muted-foreground"
          data-test="audience-comments-list-empty"
        >
          No comments match.
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-md border">
          {rows.map((comment) => (
            <li
              key={comment.id}
              className="flex flex-col gap-1 p-3"
              data-test="audience-comment"
            >
              <p className="text-sm whitespace-pre-wrap">{comment.text}</p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {new Date(comment.commentedAt).toLocaleDateString()} ·{' '}
                  {comment.videoTitle ?? 'Untitled'} ·{' '}
                  {platformLabel(comment.platform)}
                  {comment.isReply ? ' · reply' : ''}
                  {comment.likeCount > 0
                    ? ` · ${comment.likeCount} like${comment.likeCount === 1 ? '' : 's'}`
                    : ''}
                </span>
                {comment.label ? (
                  <>
                    <span
                      className="inline-flex items-center gap-1"
                      data-test="audience-comment-sentiment"
                    >
                      <SentimentSwatch sentiment={comment.label.sentiment} />
                      {SENTIMENT_LABEL[comment.label.sentiment]}
                    </span>
                    {comment.label.topics.map((topic) => (
                      <Badge key={topic} variant="outline">
                        {COMMENT_TOPIC_LABELS[topic]}
                      </Badge>
                    ))}
                    <span>
                      labelled by{' '}
                      {comment.label.source === 'mcp'
                        ? `your AI (${comment.label.model})`
                        : 'StoryBook'}
                    </span>
                  </>
                ) : (
                  <span data-test="audience-comment-unlabelled">
                    Not labelled yet
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {comments.hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          disabled={comments.isFetchingNextPage}
          onClick={() => comments.fetchNextPage()}
          data-test="audience-comments-more"
        >
          {comments.isFetchingNextPage ? 'Loading…' : 'Show more'}
        </Button>
      )}
    </div>
  );
}
