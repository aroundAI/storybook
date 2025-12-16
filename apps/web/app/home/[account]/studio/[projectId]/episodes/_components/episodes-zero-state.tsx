'use client';

import { useState } from 'react';

import Link from 'next/link';

import { Film, Pencil, Images, Clapperboard, PlayCircle, ArrowRight } from 'lucide-react';

import { Button } from '@kit/ui/button';

import { CreateEpisodeDialog } from './create-episode-dialog';

interface EpisodesZeroStateProps {
    projectId: string;
    account: string;
}

export function EpisodesZeroState({ projectId, account }: EpisodesZeroStateProps) {
    const [dialogOpen, setDialogOpen] = useState(false);

    return (
        <div className="max-w-5xl mx-auto mt-8">
            {/* Create Episode Dialog (controlled) */}
            <CreateEpisodeDialog
                projectId={projectId}
                account={account}
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                triggerButton={false}
            />

            {/* Main Hero Card */}
            <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm p-10 text-center relative overflow-hidden">
                {/* Subtle gradient glow */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />

                <div className="relative z-10 flex flex-col items-center">
                    {/* Icon */}
                    <div className="w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-2xl flex items-center justify-center mb-6 shadow-inner">
                        <Film className="w-8 h-8 text-zinc-400 dark:text-zinc-500" />
                    </div>

                    {/* Heading */}
                    <h2 className="text-2xl font-semibold text-zinc-900 dark:text-white mb-3">
                        Start Your Season 1
                    </h2>

                    {/* Description */}
                    <p className="text-zinc-500 dark:text-zinc-400 max-w-lg mx-auto mb-8 leading-relaxed">
                        Episodes are the containers for your story. Within each episode, our AI assists you in drafting the script, generating shot lists, and producing final video content.
                    </p>

                    {/* CTAs */}
                    <div className="flex flex-col sm:flex-row gap-4 justify-center items-center w-full">
                        <Button
                            onClick={() => setDialogOpen(true)}
                            className="bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100 text-white gap-2 px-6 py-3 h-auto text-sm font-medium rounded-lg shadow-md"
                        >
                            <Film className="w-4 h-4" />
                            Create First Episode
                        </Button>
                        <Link
                            href="#"
                            className="px-6 py-3 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-all flex items-center gap-2"
                        >
                            <PlayCircle className="w-4 h-4" />
                            Watch Quick Tutorial
                        </Link>
                    </div>
                </div>
            </div>

            {/* Feature Cards */}
            <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Write & Refine */}
                <div className="p-6 rounded-lg border border-transparent hover:border-zinc-200 dark:hover:border-zinc-800 hover:bg-white dark:hover:bg-zinc-900 transition-all group">
                    <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                        <Pencil className="w-5 h-5" />
                    </div>
                    <h3 className="text-base font-semibold text-zinc-900 dark:text-white mb-2">
                        1. Write & Refine
                    </h3>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
                        Draft your screenplay manually or use AI to expand a simple prompt into a full dialogue script.
                    </p>
                </div>

                {/* Visuals & Audio */}
                <div className="p-6 rounded-lg border border-transparent hover:border-zinc-200 dark:hover:border-zinc-800 hover:bg-white dark:hover:bg-zinc-900 transition-all group">
                    <div className="w-10 h-10 bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                        <Images className="w-5 h-5" />
                    </div>
                    <h3 className="text-base font-semibold text-zinc-900 dark:text-white mb-2">
                        2. Visuals & Audio
                    </h3>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
                        Generate consistent characters, locations, and voices that persist across the entire season.
                    </p>
                </div>

                {/* Production */}
                <div className="p-6 rounded-lg border border-transparent hover:border-zinc-200 dark:hover:border-zinc-800 hover:bg-white dark:hover:bg-zinc-900 transition-all group">
                    <div className="w-10 h-10 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                        <Clapperboard className="w-5 h-5" />
                    </div>
                    <h3 className="text-base font-semibold text-zinc-900 dark:text-white mb-2">
                        3. Production
                    </h3>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
                        Compile your assets into a final cut with AI-driven editing, sound mixing, and shot composition.
                    </p>
                </div>
            </div>

            {/* Example Season Structure Preview */}
            <div className="mt-12">
                <div className="flex items-center justify-between mb-6">
                    <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
                        Example Season Structure
                    </h3>
                    <span className="text-xs text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded">
                        Preview Mode
                    </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 opacity-60 grayscale-[30%] hover:grayscale-0 hover:opacity-100 transition-all duration-500 cursor-not-allowed select-none">
                    {/* Example Episode 1 */}
                    <div className="bg-white dark:bg-zinc-900 border border-dashed border-zinc-200 dark:border-zinc-700 rounded-xl p-6 relative">
                        <div className="absolute top-4 right-4 text-xs font-bold text-zinc-300 dark:text-zinc-600 border border-zinc-200 dark:border-zinc-700 px-2 py-0.5 rounded">
                            EXAMPLE
                        </div>
                        <div className="text-5xl font-light text-zinc-200 dark:text-zinc-700 mb-4">01</div>
                        <h4 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-6 truncate">
                            The Origami Lion&apos;s Request
                        </h4>
                        <div className="flex items-center gap-2 mb-4">
                            <span className="w-2 h-2 rounded-full bg-zinc-300" />
                            <span className="text-xs text-zinc-400">Story</span>
                            <span className="w-2 h-2 rounded-full bg-zinc-300 ml-2" />
                            <span className="text-xs text-zinc-400">Screenplay</span>
                            <span className="w-2 h-2 rounded-full bg-zinc-300 ml-2" />
                            <span className="text-xs text-zinc-400">Shots</span>
                        </div>
                        <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800 flex justify-between items-center">
                            <span className="text-xs text-zinc-400">Updated recently</span>
                            <ArrowRight className="w-4 h-4 text-zinc-300" />
                        </div>
                    </div>

                    {/* Example Episode 2 */}
                    <div className="bg-white dark:bg-zinc-900 border border-dashed border-zinc-200 dark:border-zinc-700 rounded-xl p-6 relative">
                        <div className="absolute top-4 right-4 text-xs font-bold text-zinc-300 dark:text-zinc-600 border border-zinc-200 dark:border-zinc-700 px-2 py-0.5 rounded">
                            EXAMPLE
                        </div>
                        <div className="text-5xl font-light text-zinc-200 dark:text-zinc-700 mb-4">02</div>
                        <h4 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-6 truncate">
                            Cub in the Crease Maze
                        </h4>
                        <div className="flex items-center gap-2 mb-4">
                            <span className="w-2 h-2 rounded-full bg-zinc-300" />
                            <span className="text-xs text-zinc-400">Story</span>
                            <span className="w-2 h-2 rounded-full bg-zinc-300 ml-2" />
                            <span className="text-xs text-zinc-400">Screenplay</span>
                            <span className="w-2 h-2 rounded-full bg-zinc-200" />
                        </div>
                        <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800 flex justify-between items-center">
                            <span className="text-xs text-zinc-400">Updated yesterday</span>
                            <ArrowRight className="w-4 h-4 text-zinc-300" />
                        </div>
                    </div>

                    {/* Example Episode 3 */}
                    <div className="bg-white dark:bg-zinc-900 border border-dashed border-zinc-200 dark:border-zinc-700 rounded-xl p-6 relative hidden lg:block">
                        <div className="absolute top-4 right-4 text-xs font-bold text-zinc-300 dark:text-zinc-600 border border-zinc-200 dark:border-zinc-700 px-2 py-0.5 rounded">
                            EXAMPLE
                        </div>
                        <div className="text-5xl font-light text-zinc-200 dark:text-zinc-700 mb-4">03</div>
                        <h4 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-6 truncate">
                            Claybird&apos;s Droopy Wings
                        </h4>
                        <div className="flex items-center gap-2 mb-4">
                            <span className="w-2 h-2 rounded-full bg-zinc-300" />
                            <span className="text-xs text-zinc-400">Story</span>
                            <span className="w-2 h-2 rounded-full bg-zinc-200 ml-2" />
                            <span className="text-xs text-zinc-300">Screenplay</span>
                        </div>
                        <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800 flex justify-between items-center">
                            <span className="text-xs text-zinc-400">Updated 2 days ago</span>
                            <ArrowRight className="w-4 h-4 text-zinc-300" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
