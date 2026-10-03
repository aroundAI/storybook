'use client';

import { Bot, Loader2, X } from 'lucide-react';

import { Button } from '@kit/ui/button';

import { externalClientLabel } from '../lib/generation-origin';
import { type OpenExternalRun, STAGE_LABELS } from '../lib/stage-runs';

function startedAtLabel(iso: string) {
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Shown on a studio page while an MCP client holds one of its stages
 * (FILM-1910): who is writing what, since when, and, once the run cancel
 * path exists, a Cancel button. The page disables its Generate buttons for
 * as long as this shows.
 */
export function ExternalRunBanner({
  runs,
  onCancel,
  cancellingRunId,
}: {
  runs: OpenExternalRun[];
  onCancel?: (runId: string) => void;
  cancellingRunId?: string | null;
}) {
  if (runs.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-test="external-run-banner"
      className="flex flex-col gap-2 border-b border-amber-500/30 bg-amber-50 px-6 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
    >
      {runs.map((run) => {
        const client = externalClientLabel(run.clientName);
        const cancelling = cancellingRunId === run.id;

        return (
          <div
            key={run.id}
            data-test="external-run"
            data-run-id={run.id}
            data-stage={run.stage}
            className="flex flex-wrap items-center gap-x-3 gap-y-1"
          >
            <Bot className="h-4 w-4 shrink-0" aria-hidden />
            <span className="font-semibold">{client} is working on this</span>
            <span className="text-amber-800/80 dark:text-amber-200/80">
              Writing {STAGE_LABELS[run.stage] ?? run.stage}
              {run.clientName ? ` from ${run.clientName}` : ''}, started{' '}
              <time dateTime={run.startedAt}>
                {startedAtLabel(run.startedAt)}
              </time>
              . Generating here is paused until it finishes.
            </span>

            {onCancel && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="ml-auto gap-1.5 border-amber-500/40 bg-transparent"
                data-test="external-run-cancel"
                disabled={cancelling}
                onClick={() => onCancel(run.id)}
              >
                {cancelling ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <X className="h-3.5 w-3.5" />
                )}
                Cancel
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
