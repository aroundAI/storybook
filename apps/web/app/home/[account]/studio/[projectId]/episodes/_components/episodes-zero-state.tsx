'use client';

import { useState } from 'react';

import Link from 'next/link';

import {
  ArrowRight,
  Clapperboard,
  Film,
  Images,
  Pencil,
  PlayCircle,
} from 'lucide-react';

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
    <div className="mx-auto mt-8 max-w-5xl">
      {/* Create Episode Dialog (controlled) */}
      <CreateEpisodeDialog
        projectId={projectId}
        account={account}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        triggerButton={false}
      />

      {/* Main Hero Card */}
      <div className="relative overflow-hidden rounded-xl border border-zinc-200 bg-white p-10 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        {/* Subtle gradient glow */}
        <div className="pointer-events-none absolute top-0 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-indigo-500/5 blur-3xl" />

        <div className="relative z-10 flex flex-col items-center">
          {/* Icon */}
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-100 shadow-inner dark:bg-zinc-800">
            <Film className="h-8 w-8 text-zinc-400 dark:text-zinc-500" />
          </div>

          {/* Heading */}
          <h2 className="mb-3 text-2xl font-semibold text-zinc-900 dark:text-white">
            Start Your Season 1
          </h2>

          {/* Description */}
          <p className="mx-auto mb-8 max-w-lg leading-relaxed text-zinc-500 dark:text-zinc-400">
            Episodes are the containers for your story. Within each episode, our
            AI assists you in drafting the script, generating shot lists, and
            producing final video content.
          </p>

          {/* CTAs */}
          <div className="flex w-full flex-col items-center justify-center gap-4 sm:flex-row">
            <Button
              onClick={() => setDialogOpen(true)}
              className="h-auto gap-2 rounded-lg bg-zinc-900 px-6 py-3 text-sm font-medium text-white shadow-md hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
            >
              <Film className="h-4 w-4" />
              Create First Episode
            </Button>
            <Link
              href="#"
              className="flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-medium text-indigo-600 transition-all hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-900/20"
            >
              <PlayCircle className="h-4 w-4" />
              Watch Quick Tutorial
            </Link>
          </div>
        </div>
      </div>

      {/* Feature Cards */}
      <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* Write & Refine */}
        <div className="group rounded-lg border border-transparent p-6 transition-all hover:border-zinc-200 hover:bg-white dark:hover:border-zinc-800 dark:hover:bg-zinc-900">
          <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 transition-transform group-hover:scale-110 dark:bg-indigo-900/30 dark:text-indigo-400">
            <Pencil className="h-5 w-5" />
          </div>
          <h3 className="mb-2 text-base font-semibold text-zinc-900 dark:text-white">
            1. Write & Refine
          </h3>
          <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            Draft your screenplay manually or use AI to expand a simple prompt
            into a full dialogue script.
          </p>
        </div>

        {/* Visuals & Audio */}
        <div className="group rounded-lg border border-transparent p-6 transition-all hover:border-zinc-200 hover:bg-white dark:hover:border-zinc-800 dark:hover:bg-zinc-900">
          <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-purple-50 text-purple-600 transition-transform group-hover:scale-110 dark:bg-purple-900/30 dark:text-purple-400">
            <Images className="h-5 w-5" />
          </div>
          <h3 className="mb-2 text-base font-semibold text-zinc-900 dark:text-white">
            2. Visuals & Audio
          </h3>
          <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            Generate consistent characters, locations, and voices that persist
            across the entire season.
          </p>
        </div>

        {/* Production */}
        <div className="group rounded-lg border border-transparent p-6 transition-all hover:border-zinc-200 hover:bg-white dark:hover:border-zinc-800 dark:hover:bg-zinc-900">
          <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 transition-transform group-hover:scale-110 dark:bg-emerald-900/30 dark:text-emerald-400">
            <Clapperboard className="h-5 w-5" />
          </div>
          <h3 className="mb-2 text-base font-semibold text-zinc-900 dark:text-white">
            3. Production
          </h3>
          <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            Compile your assets into a final cut with AI-driven editing, sound
            mixing, and shot composition.
          </p>
        </div>
      </div>

      {/* Example Season Structure Preview */}
      <div className="mt-12">
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-sm font-semibold tracking-wider text-zinc-400 uppercase">
            Example Season Structure
          </h3>
          <span className="rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-400 dark:bg-zinc-800">
            Preview Mode
          </span>
        </div>

        <div className="grid cursor-not-allowed grid-cols-1 gap-6 opacity-60 grayscale-[30%] transition-all duration-500 select-none hover:opacity-100 hover:grayscale-0 md:grid-cols-2 lg:grid-cols-3">
          {/* Example Episode 1 */}
          <div className="relative rounded-xl border border-dashed border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-900">
            <div className="absolute top-4 right-4 rounded border border-zinc-200 px-2 py-0.5 text-xs font-bold text-zinc-300 dark:border-zinc-700 dark:text-zinc-600">
              EXAMPLE
            </div>
            <div className="mb-4 text-5xl font-light text-zinc-200 dark:text-zinc-700">
              01
            </div>
            <h4 className="mb-6 truncate text-lg font-semibold text-zinc-800 dark:text-zinc-200">
              The Origami Lion&apos;s Request
            </h4>
            <div className="mb-4 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-zinc-300" />
              <span className="text-xs text-zinc-400">Story</span>
              <span className="ml-2 h-2 w-2 rounded-full bg-zinc-300" />
              <span className="text-xs text-zinc-400">Screenplay</span>
              <span className="ml-2 h-2 w-2 rounded-full bg-zinc-300" />
              <span className="text-xs text-zinc-400">Shots</span>
            </div>
            <div className="flex items-center justify-between border-t border-zinc-100 pt-4 dark:border-zinc-800">
              <span className="text-xs text-zinc-400">Updated recently</span>
              <ArrowRight className="h-4 w-4 text-zinc-300" />
            </div>
          </div>

          {/* Example Episode 2 */}
          <div className="relative rounded-xl border border-dashed border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-900">
            <div className="absolute top-4 right-4 rounded border border-zinc-200 px-2 py-0.5 text-xs font-bold text-zinc-300 dark:border-zinc-700 dark:text-zinc-600">
              EXAMPLE
            </div>
            <div className="mb-4 text-5xl font-light text-zinc-200 dark:text-zinc-700">
              02
            </div>
            <h4 className="mb-6 truncate text-lg font-semibold text-zinc-800 dark:text-zinc-200">
              Cub in the Crease Maze
            </h4>
            <div className="mb-4 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-zinc-300" />
              <span className="text-xs text-zinc-400">Story</span>
              <span className="ml-2 h-2 w-2 rounded-full bg-zinc-300" />
              <span className="text-xs text-zinc-400">Screenplay</span>
              <span className="h-2 w-2 rounded-full bg-zinc-200" />
            </div>
            <div className="flex items-center justify-between border-t border-zinc-100 pt-4 dark:border-zinc-800">
              <span className="text-xs text-zinc-400">Updated yesterday</span>
              <ArrowRight className="h-4 w-4 text-zinc-300" />
            </div>
          </div>

          {/* Example Episode 3 */}
          <div className="relative hidden rounded-xl border border-dashed border-zinc-200 bg-white p-6 lg:block dark:border-zinc-700 dark:bg-zinc-900">
            <div className="absolute top-4 right-4 rounded border border-zinc-200 px-2 py-0.5 text-xs font-bold text-zinc-300 dark:border-zinc-700 dark:text-zinc-600">
              EXAMPLE
            </div>
            <div className="mb-4 text-5xl font-light text-zinc-200 dark:text-zinc-700">
              03
            </div>
            <h4 className="mb-6 truncate text-lg font-semibold text-zinc-800 dark:text-zinc-200">
              Claybird&apos;s Droopy Wings
            </h4>
            <div className="mb-4 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-zinc-300" />
              <span className="text-xs text-zinc-400">Story</span>
              <span className="ml-2 h-2 w-2 rounded-full bg-zinc-200" />
              <span className="text-xs text-zinc-300">Screenplay</span>
            </div>
            <div className="flex items-center justify-between border-t border-zinc-100 pt-4 dark:border-zinc-800">
              <span className="text-xs text-zinc-400">Updated 2 days ago</span>
              <ArrowRight className="h-4 w-4 text-zinc-300" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
