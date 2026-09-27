'use client';

import { useState, useTransition } from 'react';

import type { ContentTag } from '@kit/content-analytics/components';
import { TagManager } from '@kit/content-analytics/components';
import {
  createTagAction,
  deleteTagAction,
} from '@kit/content-analytics/server/taxonomy-actions';
import { unwrap } from '@kit/next/action-result';

interface TagManagerClientProps {
  /** Account whose vocabulary is being edited */
  accountId: string;
  /** Tags loaded on the server for the first render */
  initialTags: ContentTag[];
}

/**
 * Client wrapper holding the tag list so additions and deletions appear
 * immediately without a full route refresh.
 */
export function TagManagerClient({
  accountId,
  initialTags,
}: TagManagerClientProps) {
  const [tags, setTags] = useState(initialTags);
  const [, startTransition] = useTransition();

  return (
    <TagManager
      accountId={accountId}
      tags={tags}
      onCreate={async (input) => {
        const created = await unwrap(createTagAction(input));

        startTransition(() => {
          setTags((current) => [...current, created as ContentTag]);
        });
      }}
      onDelete={async (tagId) => {
        await unwrap(deleteTagAction({ tagId }));

        startTransition(() => {
          setTags((current) => current.filter((tag) => tag.id !== tagId));
        });
      }}
    />
  );
}
