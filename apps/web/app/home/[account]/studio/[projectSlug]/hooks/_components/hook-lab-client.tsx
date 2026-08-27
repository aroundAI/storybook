'use client';

import { useState } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';

import type {
  HookTestEntry,
  VariantRetentionEntry,
} from '@kit/content-analytics/components';
import {
  HookTestList,
  HookTestListSkeleton,
  RetentionComparisonChart,
  RetentionComparisonChartSkeleton,
} from '@kit/content-analytics/components';
import {
  getHookTestAction,
  listHookTestsAction,
  refreshHookTestAction,
} from '@kit/content-analytics/server';
import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
import { toast } from '@kit/ui/sonner';

interface HookLabClientProps {
  /** Account the tests belong to */
  accountId: string;
  /** Project scope */
  projectId: string;
}

interface HookVariantRow {
  id: string;
  label: string | null;
  hook_type: string;
  retention_3s: number | null;
  retention_full: number | null;
  is_winner: boolean;
}

/**
 * Hook Lab workbench: lists tests and compares their variants' 3-second
 * retention against the test threshold.
 */
export function HookLabClient({ accountId, projectId }: HookLabClientProps) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const listQuery = useQuery({
    queryKey: ['hook-tests', accountId, projectId],
    queryFn: () => listHookTestsAction({ accountId, projectId }),
  });

  const detailQuery = useQuery({
    queryKey: ['hook-test', selectedId],
    queryFn: () => getHookTestAction({ testId: selectedId! }),
    enabled: Boolean(selectedId),
  });

  const test = detailQuery.data;

  const variants: VariantRetentionEntry[] = (
    (test?.variants ?? []) as HookVariantRow[]
  ).map((variant, index) => ({
    id: variant.id,
    label: variant.label ?? `Variant ${String.fromCharCode(65 + index)}`,
    hookType: variant.hook_type,
    retention3s: variant.retention_3s,
    retentionFull: variant.retention_full,
    isWinner: variant.is_winner,
  }));

  return (
    <div className={'flex flex-col gap-6'}>
      {listQuery.isLoading ? (
        <HookTestListSkeleton />
      ) : (
        <HookTestList
          tests={(listQuery.data ?? []) as HookTestEntry[]}
          onSelect={setSelectedId}
        />
      )}

      <Dialog
        open={Boolean(selectedId)}
        onOpenChange={(open) => !open && setSelectedId(null)}
      >
        <DialogContent className={'max-h-[85vh] overflow-y-auto sm:max-w-2xl'}>
          <DialogHeader>
            <DialogTitle>{test?.name ?? 'Hook test'}</DialogTitle>
          </DialogHeader>

          {detailQuery.isLoading || !test ? (
            <RetentionComparisonChartSkeleton />
          ) : (
            <div className={'flex flex-col gap-4'}>
              {test.hypothesis ? (
                <p className={'text-muted-foreground text-sm'}>
                  {test.hypothesis}
                </p>
              ) : null}

              <RetentionComparisonChart
                variants={variants}
                viralThreshold={Number(test.viral_threshold)}
              />

              <Button
                variant={'outline'}
                className={'self-start'}
                disabled={isRefreshing}
                onClick={async () => {
                  setIsRefreshing(true);
                  try {
                    const result = await refreshHookTestAction({
                      testId: test.id,
                    });
                    toast.success(
                      result.winnerVariantId
                        ? 'Retention refreshed — winner declared'
                        : `Retention refreshed for ${result.updated} variants; none cleared the threshold`,
                    );
                    await Promise.all([
                      detailQuery.refetch(),
                      queryClient.invalidateQueries({
                        queryKey: ['hook-tests', accountId, projectId],
                      }),
                    ]);
                  } catch (error) {
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : 'Could not refresh retention',
                    );
                  } finally {
                    setIsRefreshing(false);
                  }
                }}
              >
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`}
                />
                Refresh retention
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
