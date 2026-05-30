'use client';

import {
  AlertCircle,
  CheckCircle,
  Loader2,
  XCircle,
} from 'lucide-react';

import type { BatchStatus } from './use-batch-generation';

interface BatchProgressBarProps {
  batchStatus: BatchStatus;
  isGenerating: boolean;
  onDismiss: () => void;
}

export function BatchProgressBar({
  batchStatus,
  isGenerating,
  onDismiss,
}: BatchProgressBarProps) {
  return (
    <div className="border-b border-gray-200/50 bg-gradient-to-r from-blue-50/80 to-indigo-50/80 px-4 py-2.5 backdrop-blur-xl dark:border-white/5 dark:from-blue-950/30 dark:to-indigo-950/30">
      <div className="flex items-center gap-3">
        {/* Status icon */}
        {isGenerating ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-600 dark:text-blue-400" />
        ) : batchStatus.status === 'completed' ? (
          <CheckCircle className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
        ) : batchStatus.status === 'completed_with_errors' ? (
          <AlertCircle className="h-4 w-4 shrink-0 text-yellow-600 dark:text-yellow-400" />
        ) : batchStatus.status === 'failed' ? (
          <XCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
        ) : batchStatus.status === 'cancelled' ? (
          <AlertCircle className="h-4 w-4 shrink-0 text-orange-600 dark:text-orange-400" />
        ) : null}

        {/* Progress text */}
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
          {isGenerating
            ? `Generating voices... ${batchStatus.completed}/${batchStatus.total}`
            : batchStatus.status === 'completed'
              ? `✓ All ${batchStatus.completed} voice(s) generated`
              : batchStatus.status === 'completed_with_errors'
                ? `⚠ ${batchStatus.completed} generated, ${batchStatus.failed} failed`
                : batchStatus.status === 'failed'
                  ? `✗ Failed: ${batchStatus.completed} completed, ${batchStatus.failed} failed`
                  : batchStatus.status === 'cancelled'
                    ? `Cancelled: ${batchStatus.completed} completed`
                    : `${batchStatus.status}`}
          {batchStatus.failed > 0 && isGenerating && (
            <span className="ml-1 text-red-600 dark:text-red-400">
              ({batchStatus.failed} failed)
            </span>
          )}
        </span>

        {/* Progress bar */}
        <div className="h-2 min-w-[120px] flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
          <div className="flex h-full">
            <div
              className="h-full rounded-l-full bg-green-500 transition-all duration-500 dark:bg-green-400"
              style={{
                width: `${batchStatus.total > 0 ? (batchStatus.completed / batchStatus.total) * 100 : 0}%`,
              }}
            />
            {batchStatus.failed > 0 && (
              <div
                className="h-full bg-red-500 transition-all duration-500 dark:bg-red-400"
                style={{
                  width: `${(batchStatus.failed / batchStatus.total) * 100}%`,
                }}
              />
            )}
          </div>
        </div>

        {/* Percentage */}
        <span className="text-xs font-semibold text-gray-600 tabular-nums dark:text-gray-400">
          {batchStatus.percentage}%
        </span>

        {/* Dismiss button (when not generating) */}
        {!isGenerating && (
          <button
            onClick={onDismiss}
            className="ml-1 rounded-md p-0.5 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
            title="Dismiss"
          >
            <XCircle className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
