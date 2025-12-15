'use client';

import Link from 'next/link';

import { FileText, Sparkles, Upload } from 'lucide-react';

interface GenesisOptionsProps {
    baseUrl: string;
}

export function GenesisOptions({ baseUrl }: GenesisOptionsProps) {
    return (
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
            {/* Header */}
            <div className="p-6 border-b border-zinc-200 dark:border-zinc-800">
                <h2 className="text-lg font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-purple-500" />
                    Choose Your Genesis
                </h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                    Select how you want to start creating your first episode
                </p>
            </div>

            {/* Options Grid */}
            <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Option 1: Use a Template */}
                <Link
                    href={`${baseUrl}/episodes`}
                    className="group p-6 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:border-purple-300 dark:hover:border-purple-700 hover:bg-purple-50 dark:hover:bg-purple-900/10 transition-all cursor-pointer"
                >
                    <div className="w-12 h-12 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                        <FileText className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                    </div>
                    <h3 className="font-semibold text-zinc-900 dark:text-white mb-2">
                        Use a Template
                    </h3>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
                        Start with a pre-written story template for common genres and formats.
                    </p>
                </Link>

                {/* Option 2: Import a Script */}
                <Link
                    href={`${baseUrl}/episodes`}
                    className="group p-6 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-all cursor-pointer"
                >
                    <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                        <Upload className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                    </div>
                    <h3 className="font-semibold text-zinc-900 dark:text-white mb-2">
                        Import a Script
                    </h3>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
                        Upload an existing screenplay or story document to kickstart production.
                    </p>
                </Link>

                {/* Option 3: Brainstorm with AI */}
                <Link
                    href={`${baseUrl}/episodes`}
                    className="group p-6 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:border-indigo-300 dark:hover:border-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-900/10 transition-all cursor-pointer"
                >
                    <div className="w-12 h-12 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                        <Sparkles className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <h3 className="font-semibold text-zinc-900 dark:text-white mb-2">
                        Brainstorm with AI
                    </h3>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
                        Co-create your story from scratch with AI-powered ideation and writing.
                    </p>
                </Link>
            </div>
        </div>
    );
}
