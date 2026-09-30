'use client';

import { useCallback, useMemo } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { bulkTagInChunks, chunkPublishIds } from '../lib/bulk-tag';
import type { ContentListItem } from '../server/aggregation-queries';
import {
  bulkTagPublishesAction,
  getPublishTagsAction,
  listTagsAction,
} from '../server/taxonomy-actions';
import { ContentTable } from './content-table';
import type { ContentTag } from './taxonomy/tag-manager';

interface ContentTablePanelProps {
  accountId: string;
  projectId: string;
  data: ContentListItem[] | undefined;
  isLoading: boolean;
}

/**
 * The content table with its tags: reads the account's vocabulary and each
 * row's assignments, and tags the selected rows through `bulkTagPublishesAction`.
 */
export function ContentTablePanel({
  accountId,
  projectId,
  data,
  isLoading,
}: ContentTablePanelProps) {
  const queryClient = useQueryClient();
  const publishIds = useMemo(
    () => (data ?? []).map((item) => item.publishId),
    [data],
  );

  const tagsQuery = useQuery({
    queryKey: ['content-tags', accountId],
    queryFn: () => listTagsAction({ accountId }),
  });

  const assignmentsKey = ['content-publish-tags', projectId, publishIds];
  const assignmentsQuery = useQuery({
    queryKey: assignmentsKey,
    queryFn: async () => {
      const chunks = await Promise.all(
        chunkPublishIds(publishIds).map((chunk) =>
          getPublishTagsAction({ publishIds: chunk }),
        ),
      );

      return Object.assign({}, ...chunks) as Record<string, ContentTag[]>;
    },
    enabled: publishIds.length > 0,
  });

  const onApply = useCallback(
    async (ids: string[], tagIds: string[]) => {
      let outcome;

      try {
        outcome = await bulkTagInChunks(
          { publishIds: ids, tagIds },
          bulkTagPublishesAction,
        );
      } catch {
        return 'The request did not reach the server, so nothing was tagged. Try again.';
      }

      await queryClient.invalidateQueries({
        queryKey: ['content-publish-tags', projectId],
      });

      return outcome.ok
        ? null
        : `${outcome.error} ${outcome.taggedCount} of ${ids.length} were tagged before this stopped.`;
    },
    [projectId, queryClient],
  );

  return (
    <ContentTable
      data={data}
      isLoading={isLoading}
      tagging={{
        tags: tagsQuery.data ?? [],
        tagsByPublish: assignmentsQuery.data ?? {},
        isLoading: tagsQuery.isLoading || assignmentsQuery.isLoading,
        isError:
          (tagsQuery.isError && tagsQuery.data === undefined) ||
          (assignmentsQuery.isError && assignmentsQuery.data === undefined),
        onApply,
      }}
    />
  );
}
