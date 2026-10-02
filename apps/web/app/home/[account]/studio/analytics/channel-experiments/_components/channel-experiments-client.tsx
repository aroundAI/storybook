'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { FORMAT_FAMILY_LABEL, type FormatFamily } from '@kit/clickhouse';
import { listChannelExperimentsAction } from '@kit/content-analytics/server/channel-experiment-actions';
import { listChannelsAction } from '@kit/content-analytics/server/channels-actions';
import { Badge } from '@kit/ui/badge';
import { Skeleton } from '@kit/ui/skeleton';

import { ChannelExperimentDetail } from './channel-experiment-detail';
import { CreateChannelExperimentForm } from './create-channel-experiment-form';

const STATUS_LABEL: Record<string, string> = {
  planned: 'Planned',
  running: 'Running',
  concluded: 'Concluded',
  abandoned: 'Abandoned',
};

/** The channel experiments page: create, list, and one experiment's detail. */
export function ChannelExperimentsClient({ accountId }: { accountId: string }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get('experiment');

  const select = (id: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set('experiment', id);
    else params.delete('experiment');
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  };

  const listQuery = useQuery({
    queryKey: ['channel-experiments', accountId],
    queryFn: () => listChannelExperimentsAction({ accountId }),
  });

  const channelsQuery = useQuery({
    queryKey: ['channel-experiment-channels', accountId],
    queryFn: () => listChannelsAction({ accountId }),
  });

  const channels = channelsQuery.data ?? [];
  const channelName = (id: string) =>
    channels.find((channel) => channel.connectionId === id)?.name ?? 'Channel';

  const refreshList = () =>
    queryClient.invalidateQueries({
      queryKey: ['channel-experiments', accountId],
    });

  return (
    <div className={'flex flex-col gap-8'}>
      <section className={'flex flex-col gap-3'}>
        <h3 className={'text-sm font-medium'}>New experiment</h3>
        <CreateChannelExperimentForm
          accountId={accountId}
          channels={channels}
          channelsLoading={channelsQuery.isLoading}
          onCreated={refreshList}
        />
      </section>

      <section className={'flex flex-col gap-3'}>
        <h3 className={'text-sm font-medium'}>Experiments</h3>
        {listQuery.isLoading ? (
          <Skeleton className={'h-16 w-full'} />
        ) : listQuery.isError ? (
          <p
            className={'text-sm text-muted-foreground'}
            data-test={'ce-list-error'}
          >
            Experiments could not be loaded.
          </p>
        ) : (listQuery.data ?? []).length === 0 ? (
          <p
            className={'text-sm text-muted-foreground'}
            data-test={'ce-list-empty'}
          >
            No channel experiments yet.
          </p>
        ) : (
          <ul
            className={'flex flex-col divide-y rounded-lg border'}
            data-test={'ce-list'}
          >
            {(listQuery.data ?? []).map((row) => (
              <li key={row.id}>
                <button
                  type={'button'}
                  onClick={() => select(row.id)}
                  className={
                    'flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left hover:bg-muted/50 aria-[current=true]:bg-muted'
                  }
                  aria-current={row.id === selectedId}
                  data-test={`ce-row-${row.id}`}
                >
                  <span className={'font-medium'}>{row.title}</span>
                  <span
                    className={
                      'flex items-center gap-2 text-xs text-muted-foreground'
                    }
                  >
                    {channelName(row.connection_id)} ·{' '}
                    {FORMAT_FAMILY_LABEL[row.format_family as FormatFamily] ??
                      row.format_family}
                    <Badge variant={'outline'}>
                      {STATUS_LABEL[row.status] ?? row.status}
                    </Badge>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selectedId ? (
        <ChannelExperimentDetail
          key={selectedId}
          experimentId={selectedId}
          channelName={channelName}
          onChanged={refreshList}
          onRemoved={async () => {
            select(null);
            await refreshList();
          }}
        />
      ) : null}
    </div>
  );
}
