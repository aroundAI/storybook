'use client';

import { useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Download, FileText, Loader2, Table, Trash2 } from 'lucide-react';

import { refusalMessage, unwrap } from '@kit/next/action-result';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@kit/ui/alert-dialog';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Card, CardContent } from '@kit/ui/card';
import { Skeleton } from '@kit/ui/skeleton';

import type { GeneratedReportRecord } from '../lib/report-types';
import { REPORT_HISTORY_PAGE_SIZE } from '../lib/schemas/report.schema';
import {
  deleteGeneratedReportAction,
  getGeneratedReportDownloadAction,
  listGeneratedReportsAction,
} from '../server/report-actions';

export const reportHistoryKey = (accountId: string) =>
  ['report-history', accountId] as const;

interface ReportHistoryProps {
  accountId: string;
}

const formatDay = (day: string) => format(new Date(`${day}T00:00:00`), 'PP');

export function ReportHistory({ accountId }: ReportHistoryProps) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<{
    offset: number;
    pendingDelete: GeneratedReportRecord | null;
    actionError: string | null;
  }>({ offset: 0, pendingDelete: null, actionError: null });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [...reportHistoryKey(accountId), state.offset],
    queryFn: () =>
      unwrap(
        listGeneratedReportsAction({
          accountId,
          limit: REPORT_HISTORY_PAGE_SIZE,
          offset: state.offset,
        }),
      ),
  });

  const download = useMutation({
    mutationFn: async (id: string) => {
      const { downloadUrl } = await unwrap(
        getGeneratedReportDownloadAction({ id }),
      );
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = '';
      link.click();
    },
    onMutate: () => setState((s) => ({ ...s, actionError: null })),
    onError: (err) =>
      setState((s) => ({
        ...s,
        actionError: refusalMessage(err, 'Failed to download report'),
      })),
  });

  const remove = useMutation({
    mutationFn: (id: string) => unwrap(deleteGeneratedReportAction({ id })),
    onMutate: () => setState((s) => ({ ...s, actionError: null })),
    onSuccess: async () => {
      setState((s) => ({ ...s, pendingDelete: null, offset: 0 }));
      await queryClient.invalidateQueries({
        queryKey: reportHistoryKey(accountId),
      });
    },
    onError: (err) =>
      setState((s) => ({
        ...s,
        pendingDelete: null,
        actionError: refusalMessage(err, 'Failed to delete report'),
      })),
  });

  if (isLoading) {
    return (
      <div className="space-y-3" data-test="report-history-loading">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card
        className="border-red-200 bg-red-50"
        data-test="report-history-error"
      >
        <CardContent className="flex items-center justify-between pt-6">
          <p className="text-sm text-red-800">
            {refusalMessage(error, 'Failed to load report history')}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (data.reports.length === 0 && state.offset === 0) {
    return (
      <p
        className="py-8 text-center text-sm text-muted-foreground"
        data-test="report-history-empty"
      >
        No reports generated yet. Reports you generate appear here.
      </p>
    );
  }

  return (
    <div className="space-y-3" data-test="report-history">
      {state.actionError && (
        <p
          role="alert"
          className="text-sm text-red-800"
          data-test="report-history-action-error"
        >
          {state.actionError}
        </p>
      )}

      <ul className="space-y-2">
        {data.reports.map((report) => {
          const Icon = report.reportType === 'pdf' ? FileText : Table;

          return (
            <li
              key={report.id}
              className="flex items-center justify-between gap-3 rounded-lg border p-3"
              data-test="report-history-row"
              data-report-id={report.id}
            >
              <div className="flex min-w-0 items-center gap-3">
                <Icon className="h-5 w-5 flex-shrink-0" aria-hidden />
                <div className="min-w-0">
                  <div className="flex items-center truncate text-sm font-medium">
                    <Badge variant="outline" className="mr-2 uppercase">
                      {report.reportType}
                    </Badge>
                    {formatDay(report.dateRangeStart)} -{' '}
                    {formatDay(report.dateRangeEnd)}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {report.recordCount} records, generated{' '}
                    {format(new Date(report.createdAt), 'PP p')}
                  </p>
                </div>
              </div>
              <div className="flex flex-shrink-0 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => download.mutate(report.id)}
                  disabled={download.isPending}
                  data-test="report-history-download"
                >
                  {download.isPending && download.variables === report.id ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  Download
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete ${report.fileName}`}
                  onClick={() =>
                    setState((s) => ({ ...s, pendingDelete: report }))
                  }
                  data-test="report-history-delete"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      {(state.offset > 0 || data.hasMore) && (
        <div className="flex justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={state.offset === 0}
            onClick={() =>
              setState((s) => ({
                ...s,
                offset: Math.max(0, s.offset - REPORT_HISTORY_PAGE_SIZE),
              }))
            }
            data-test="report-history-newer"
          >
            Newer
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!data.hasMore}
            onClick={() =>
              setState((s) => ({
                ...s,
                offset: s.offset + REPORT_HISTORY_PAGE_SIZE,
              }))
            }
            data-test="report-history-older"
          >
            Older
          </Button>
        </div>
      )}

      <AlertDialog
        open={state.pendingDelete !== null}
        onOpenChange={(open) =>
          !open && setState((s) => ({ ...s, pendingDelete: null }))
        }
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this report?</AlertDialogTitle>
            <AlertDialogDescription>
              The file is removed with it. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (state.pendingDelete) remove.mutate(state.pendingDelete.id);
              }}
              disabled={remove.isPending}
              data-test="report-history-confirm-delete"
            >
              {remove.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
