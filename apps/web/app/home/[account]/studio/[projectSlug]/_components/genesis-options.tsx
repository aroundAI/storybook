'use client';

import Link from 'next/link';

import { FileText, Sparkles, Upload } from 'lucide-react';

interface GenesisOptionsProps {
  baseUrl: string;
}

export function GenesisOptions({ baseUrl }: GenesisOptionsProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      {/* Header */}
      <div className="border-b border-zinc-200 p-6 dark:border-zinc-800">
        <h2 className="flex items-center gap-2 text-lg font-bold text-zinc-900 dark:text-white">
          <Sparkles className="h-5 w-5 text-purple-500" />
          Choose Your Genesis
        </h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Select how you want to start creating your first episode
        </p>
      </div>

      {/* Options Grid */}
      <div className="grid grid-cols-1 gap-4 p-6 md:grid-cols-3">
        {/* Option 1: Use a Template */}
        <Link
          href={`${baseUrl}/episodes`}
          className="group cursor-pointer rounded-xl border border-zinc-200 p-6 transition-all hover:border-purple-300 hover:bg-purple-50 dark:border-zinc-700 dark:hover:border-purple-700 dark:hover:bg-purple-900/10"
        >
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-purple-100 transition-transform group-hover:scale-110 dark:bg-purple-900/30">
            <FileText className="h-6 w-6 text-purple-600 dark:text-purple-400" />
          </div>
          <h3 className="mb-2 font-semibold text-zinc-900 dark:text-white">
            Use a Template
          </h3>
          <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            Start with a pre-written story template for common genres and
            formats.
          </p>
        </Link>

        {/* Option 2: Import a Script */}
        <Link
          href={`${baseUrl}/episodes`}
          className="group cursor-pointer rounded-xl border border-zinc-200 p-6 transition-all hover:border-blue-300 hover:bg-blue-50 dark:border-zinc-700 dark:hover:border-blue-700 dark:hover:bg-blue-900/10"
        >
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 transition-transform group-hover:scale-110 dark:bg-blue-900/30">
            <Upload className="h-6 w-6 text-blue-600 dark:text-blue-400" />
          </div>
          <h3 className="mb-2 font-semibold text-zinc-900 dark:text-white">
            Import a Script
          </h3>
          <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            Upload an existing screenplay or story document to kickstart
            production.
          </p>
        </Link>

        {/* Option 3: Brainstorm with AI */}
        <Link
          href={`${baseUrl}/episodes`}
          className="group cursor-pointer rounded-xl border border-zinc-200 p-6 transition-all hover:border-indigo-300 hover:bg-indigo-50 dark:border-zinc-700 dark:hover:border-indigo-700 dark:hover:bg-indigo-900/10"
        >
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-100 transition-transform group-hover:scale-110 dark:bg-indigo-900/30">
            <Sparkles className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
          </div>
          <h3 className="mb-2 font-semibold text-zinc-900 dark:text-white">
            Brainstorm with AI
          </h3>
          <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            Co-create your story from scratch with AI-powered ideation and
            writing.
          </p>
        </Link>
      </div>
    </div>
  );
}
