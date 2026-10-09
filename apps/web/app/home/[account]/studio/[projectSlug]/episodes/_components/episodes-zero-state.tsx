'use client';

import { useState } from 'react';

import { FolderPlus, Sparkles, Upload } from 'lucide-react';

import { Button } from '@kit/ui/button';

import { CreateEpisodeDialog } from './create-episode-dialog';
import { CreateSeasonDialog } from './create-season-dialog';
import { SeasonGeneratorDialog } from './season-generator-dialog';

interface EpisodesZeroStateProps {
  projectId: string;
  projectSlug: string;
  account: string;
}

/**
 * FILM-2203: an empty project offers three starts. Plan a season with AI is
 * today's Generate Season, unchanged (owner, 2026-10-09); a season can also
 * start empty; and a finished video can be published straight away.
 */
export function EpisodesZeroState({
  projectId,
  projectSlug,
  account,
}: EpisodesZeroStateProps) {
  const [open, setOpen] = useState<'season' | 'video' | null>(null);

  return (
    <div className="flex min-h-[calc(100vh-120px)] w-full flex-col items-center justify-center gap-8 px-4 py-12">
      <div className="text-center">
        <h2 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
          Let&apos;s make your first season
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Start from a premise, an empty season, or a video you already have.
        </p>
      </div>

      <div className="grid w-full max-w-4xl grid-cols-1 gap-4 md:grid-cols-3">
        <ZeroCard
          dataTest="zero-plan-season"
          icon={Sparkles}
          title="Plan a season with AI"
          body="Outline its episodes from your premise."
          action={<SeasonGeneratorDialog projectId={projectId} />}
        />
        <ZeroCard
          dataTest="zero-start-season"
          icon={FolderPlus}
          title="Start a season"
          body="Name it now, add episodes later."
          action={
            <Button
              variant="outline"
              onClick={() => setOpen('season')}
              data-test="zero-start-season-button"
            >
              Start a season
            </Button>
          }
        />
        <ZeroCard
          dataTest="zero-add-video"
          icon={Upload}
          title="Add a finished video"
          body="Upload a file or paste a link, then publish it."
          action={
            <Button
              variant="outline"
              onClick={() => setOpen('video')}
              data-test="zero-add-video-button"
            >
              Add a video
            </Button>
          }
        />
      </div>

      <CreateSeasonDialog
        projectId={projectId}
        open={open === 'season'}
        onOpenChange={(next) => setOpen(next ? 'season' : null)}
        triggerButton={false}
      />
      {open === 'video' && (
        <CreateEpisodeDialog
          projectId={projectId}
          projectSlug={projectSlug}
          account={account}
          defaultStartFrom="video"
          open
          onOpenChange={(next) => setOpen(next ? 'video' : null)}
          triggerButton={false}
        />
      )}
    </div>
  );
}

function ZeroCard({
  dataTest,
  icon: Icon,
  title,
  body,
  action,
}: {
  dataTest: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  action: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6 shadow-sm"
      data-test={dataTest}
    >
      <Icon className="h-6 w-6 text-primary" />
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      </div>
      <div className="mt-auto">{action}</div>
    </div>
  );
}
