'use client';

import { Loader2 } from 'lucide-react';

interface GeneratingStateProps {
    title: string;
    description?: string;
}

/**
 * Loading state component for when content is being generated in the background
 *
 * Shows a spinner and message indicating generation is in progress.
 */
export function GeneratingState({ title, description }: GeneratingStateProps) {
    return (
        <div className="flex h-full flex-col items-center justify-center p-8">
            <div className="rounded-2xl border border-gray-200 bg-card p-12 text-center shadow-sm">
                <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-primary" />
                <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white">
                    Generating {title}...
                </h2>
                <p className="max-w-md text-gray-500 dark:text-gray-400">
                    {description ?? 'This may take a few moments. You\'ll see the results once generation is complete.'}
                </p>
            </div>
        </div>
    );
}
