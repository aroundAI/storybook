'use client';

import { useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';
import { Baby } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { toast } from '@kit/ui/sonner';

import { youtubeCategoryName } from '../lib/youtube-declaration';
import type { PlatformConnection } from '../types';
import { YouTubeAudienceDialog } from './youtube-audience-dialog';

/**
 * A YouTube channel's audience and category on its Settings → Platforms row
 * (KB-30): what every upload to it declares, and where to change it.
 */
export function YouTubeAudienceSetting({
  connection,
  accountId,
}: {
  connection: PlatformConnection;
  accountId: string;
}) {
  const [editing, setEditing] = useState(false);
  const queryClient = useQueryClient();

  const declared =
    typeof connection.youtubeMadeForKids === 'boolean' &&
    Boolean(connection.youtubeCategoryId);

  const summary = declared
    ? `${connection.youtubeMadeForKids ? 'Made for kids' : 'Not made for kids'} · ${youtubeCategoryName(connection.youtubeCategoryId!)}`
    : 'Audience not set';

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setEditing(true)}
        title="Who this channel is made for, sent with every upload"
        data-test="youtube-audience-edit"
        data-declared={declared}
      >
        <Baby className="mr-1 h-3 w-3" />
        <span data-test="youtube-audience-summary">{summary}</span>
      </Button>

      {editing && (
        <YouTubeAudienceDialog
          channels={[
            {
              id: connection.id,
              name: connection.accountName,
              madeForKids: connection.youtubeMadeForKids,
              categoryId: connection.youtubeCategoryId,
            },
          ]}
          onCancel={() => setEditing(false)}
          onSaved={([answer]) => {
            setEditing(false);
            void queryClient.invalidateQueries({
              queryKey: ['platform-connections', accountId],
            });
            if (answer) {
              toast.success(
                `Audience set to ${answer.madeForKids ? 'made for kids' : 'not made for kids'} · ${youtubeCategoryName(answer.categoryId)}`,
              );
            }
          }}
        />
      )}
    </>
  );
}
