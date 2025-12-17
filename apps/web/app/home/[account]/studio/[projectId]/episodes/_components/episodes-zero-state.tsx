'use client';

import { useState } from 'react';

import { Film } from 'lucide-react';

import { Button } from '@kit/ui/button';

import { CreateEpisodeDialog } from './create-episode-dialog';

interface EpisodesZeroStateProps {
  projectId: string;
  account: string;
}

export function EpisodesZeroState({
  projectId,
  account,
}: EpisodesZeroStateProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      {/* Create Episode Dialog (controlled) */}
      <CreateEpisodeDialog
        projectId={projectId}
        account={account}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        triggerButton={false}
      />

      {/* Hero Section with Bokeh Background - Full Height */}
      <div className="relative flex min-h-[calc(100vh-120px)] w-full items-center justify-center overflow-hidden bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-900">
        {/* Animated Bokeh Effect */}
        <div
          className="pointer-events-none absolute inset-0 opacity-40 blur-3xl dark:opacity-20"
          style={{
            backgroundImage: `
              radial-gradient(circle at 20% 80%, rgba(186, 230, 253, 0.4) 0%, transparent 40%),
              radial-gradient(circle at 80% 20%, rgba(233, 213, 255, 0.4) 0%, transparent 40%),
              radial-gradient(circle at 50% 50%, rgba(254, 202, 202, 0.4) 0%, transparent 30%)
            `,
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 hidden opacity-20 blur-3xl dark:block"
          style={{
            backgroundImage: `
              radial-gradient(circle at 20% 80%, rgba(30, 58, 138, 0.4) 0%, transparent 40%),
              radial-gradient(circle at 80% 20%, rgba(76, 29, 148, 0.4) 0%, transparent 40%),
              radial-gradient(circle at 50% 50%, rgba(127, 29, 29, 0.4) 0%, transparent 30%)
            `,
          }}
        />

        {/* Hero Content */}
        <div className="relative z-10 px-4 text-center">
          <h2 className="mb-6 text-5xl font-bold tracking-tighter text-gray-900 dark:text-white">
            Unleash Your Stories
          </h2>
          <Button
            onClick={() => setDialogOpen(true)}
            size="lg"
            className="h-auto transform gap-3 rounded-xl px-8 py-4 text-lg font-medium shadow-lg transition-all hover:scale-105"
          >
            <Film className="h-5 w-5" />
            Start Crafting Your First Episode
          </Button>
          <p className="mx-auto mt-8 max-w-2xl text-base leading-relaxed text-gray-500 italic dark:text-gray-400">
            &quot;Each episode is a canvas for your imagination. From the spark
            of an idea, our tools help you weave intricate narratives, draft
            compelling screenplays, and envision the visual tapestry of your
            scenes, transforming mere concepts into captivating stories.&quot;
          </p>
        </div>
      </div>
    </>
  );
}
