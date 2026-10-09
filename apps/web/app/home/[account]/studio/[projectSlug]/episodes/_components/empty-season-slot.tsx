'use client';

import { useState } from 'react';

import { Plus, Upload } from 'lucide-react';

import type { StartFrom } from '@kit/episodes/schemas/create-episode-start';
import { Button } from '@kit/ui/button';

import {
  CreateEpisodeDialog,
  type SeasonOption,
} from './create-episode-dialog';

/**
 * FILM-2203: an empty season is a place to start, not a gap. Both actions
 * open the new-episode dialog in this season; Upload video opens it on the
 * finished-video start.
 */
export function EmptySeasonSlot({
  seasonId,
  seasons,
  projectId,
  projectSlug,
  account,
}: {
  seasonId: string;
  seasons: SeasonOption[];
  projectId: string;
  projectSlug: string;
  account: string;
}) {
  const [startFrom, setStartFrom] = useState<StartFrom | null>(null);

  return (
    <div
      className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-white/10 px-6 py-8 text-center"
      data-test="empty-season-slot"
    >
      <p className="text-sm text-muted-foreground">This season is empty.</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          size="sm"
          onClick={() => setStartFrom('idea')}
          data-test="empty-season-new-episode"
        >
          <Plus className="mr-2 h-4 w-4" />
          New episode
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setStartFrom('video')}
          data-test="empty-season-upload-video"
        >
          <Upload className="mr-2 h-4 w-4" />
          Upload video
        </Button>
      </div>

      {startFrom && (
        <CreateEpisodeDialog
          key={startFrom}
          projectId={projectId}
          projectSlug={projectSlug}
          account={account}
          seasons={seasons}
          defaultSeasonId={seasonId}
          defaultStartFrom={startFrom}
          open
          onOpenChange={(open) => {
            if (!open) setStartFrom(null);
          }}
          triggerButton={false}
        />
      )}
    </div>
  );
}
