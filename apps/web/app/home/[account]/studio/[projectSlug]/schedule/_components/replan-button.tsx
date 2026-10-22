'use client';

import { useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { Loader2, RefreshCw } from 'lucide-react';

import { refusalMessage, unwrap } from '@kit/next/action-result';
import {
  type ScheduleMove,
  ScheduleMovesTable,
  type ScheduleNotMoved,
} from '@kit/publishing/components';
import { replanScheduleAction } from '@kit/publishing/server';
import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
import { toast } from '@kit/ui/sonner';

/**
 * FILM-2213. Re-plan to posting rules: every post not yet due on the
 * project's channels, laid again on their current rules. Previewed first,
 * then applied.
 */
export function ReplanButton(props: { projectId: string }) {
  const router = useRouter();
  const [running, startTransition] = useTransition();
  const [preview, setPreview] = useState<{
    moves: ScheduleMove[];
    notMoved: ScheduleNotMoved[];
  } | null>(null);

  const timezone = () =>
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const run = (dryRun: boolean) =>
    startTransition(async () => {
      try {
        const result = await unwrap(
          replanScheduleAction({
            projectId: props.projectId,
            dryRun,
            timezone: timezone(),
          }),
        );

        if (dryRun) {
          setPreview({ moves: result.moves, notMoved: result.notMoved });
          return;
        }

        toast.success(
          `Re-planned: ${result.moves.length} post${result.moves.length === 1 ? '' : 's'} moved.`,
        );
        setPreview(
          result.notMoved.length
            ? { moves: [], notMoved: result.notMoved }
            : null,
        );
        router.refresh();
      } catch (error) {
        toast.error(refusalMessage(error, 'The re-plan did not run.'));
      }
    });

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={running}
        onClick={() => run(true)}
        data-test="schedule-replan"
      >
        {running && !preview ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="mr-2 h-4 w-4" />
        )}
        Re-plan to posting rules
      </Button>

      <Dialog
        open={!!preview}
        onOpenChange={(open) => !open && !running && setPreview(null)}
      >
        {preview && (
          <DialogContent
            className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
            data-test="schedule-replan-dialog"
          >
            <DialogHeader>
              <DialogTitle>Re-plan to posting rules</DialogTitle>
              <DialogDescription>
                Long videos keep their order on the next allowed days, then each
                channel&apos;s Shorts queue follows them. Posts due within 15
                minutes, breaking posts and times chosen past the rules stay.
              </DialogDescription>
            </DialogHeader>

            {preview.moves.length === 0 ? (
              <p className="text-sm" data-test="schedule-replan-nothing">
                Nothing to move: everything scheduled follows the posting rules.
              </p>
            ) : (
              <p className="text-sm font-medium">
                {preview.moves.length} post
                {preview.moves.length === 1 ? '' : 's'} move
              </p>
            )}
            <ScheduleMovesTable
              moves={preview.moves}
              notMoved={preview.notMoved}
            />

            <DialogFooter>
              <Button
                variant="outline"
                disabled={running}
                onClick={() => setPreview(null)}
              >
                Close
              </Button>
              {preview.moves.length > 0 && (
                <Button
                  disabled={running}
                  onClick={() => run(false)}
                  data-test="schedule-replan-apply"
                >
                  {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Apply
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
