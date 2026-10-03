'use client';

import { useEffect, useRef, useState } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useSupabase } from '@kit/supabase/hooks/use-supabase';

import {
  OPEN_RUN_STATUSES,
  type OpenExternalRun,
  listOpenExternalRuns,
} from '../lib/stage-runs';

/** While the Realtime channel is down, the runs are polled at this pace. */
export const EXTERNAL_RUNS_POLL_MS = 10_000;

/**
 * And this slowly while it is up: a channel can report SUBSCRIBED and still
 * receive nothing (a socket joined without the user's token does exactly
 * that), so a banner never outlives its run by more than a minute.
 */
export const EXTERNAL_RUNS_SAFETY_POLL_MS = 60_000;

const OPEN: readonly string[] = OPEN_RUN_STATUSES;

/**
 * The episode's open external runs, kept live (FILM-1910).
 *
 * Seeded from the layout's server read, then refreshed on every Supabase
 * Realtime event from `generation_runs` for this episode (commit, cancel,
 * expire, a new run). If the channel is not subscribed (blocked socket,
 * Realtime down), the query polls instead. Server-mode progress keeps
 * coming from `useActiveGenerationJob` and the job WebSocket as before.
 *
 * `onRunFinished` fires when any run on the episode leaves an open status,
 * so the page re-reads what the run committed.
 */
export function useOpenExternalRuns({
  episodeId,
  initialRuns,
  onRunFinished,
}: {
  episodeId: string;
  initialRuns: OpenExternalRun[];
  onRunFinished: () => void;
}) {
  const client = useSupabase();
  const queryClient = useQueryClient();
  const [isLive, setIsLive] = useState(false);

  const onFinishedRef = useRef(onRunFinished);
  onFinishedRef.current = onRunFinished;

  const query = useQuery({
    queryKey: ['open-external-runs', episodeId],
    queryFn: () => listOpenExternalRuns(client, episodeId),
    initialData: initialRuns,
    refetchInterval: isLive
      ? EXTERNAL_RUNS_SAFETY_POLL_MS
      : EXTERNAL_RUNS_POLL_MS,
  });

  const runs = query.data;

  // Realtime: one channel per episode, filtered server-side to its runs
  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof client.channel> | null = null;

    const subscribe = () =>
      client
        .channel(`generation-runs:${episodeId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'generation_runs',
            filter: `target_id=eq.${episodeId}`,
          },
          (payload) => {
            void queryClient.invalidateQueries({
              queryKey: ['open-external-runs', episodeId],
            });

            const status = (payload.new as { status?: string } | null)?.status;

            if (status && !OPEN.includes(status)) {
              onFinishedRef.current();
            }
          },
        )
        .subscribe((status) => setIsLive(status === 'SUBSCRIBED'));

    // The socket must carry the user's token before the channel joins.
    // Joined first, it joins as `anon`; Realtime then checks
    // generation_runs_read (has_account_access) with no user and drops
    // every event while still reporting SUBSCRIBED.
    void client.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;

      await client.realtime.setAuth(data.session?.access_token ?? null);

      if (cancelled) return;

      channel = subscribe();
    });

    return () => {
      cancelled = true;
      setIsLive(false);
      if (channel) void client.removeChannel(channel);
    };
  }, [client, queryClient, episodeId]);

  // A lease that lapses drops the run even before the expiry cron runs
  const nextLapse = runs
    .map((run) => (run.leaseExpiresAt ? Date.parse(run.leaseExpiresAt) : NaN))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0];

  useEffect(() => {
    if (nextLapse === undefined) return;

    const timer = setTimeout(
      () => {
        void queryClient.invalidateQueries({
          queryKey: ['open-external-runs', episodeId],
        });
      },
      Math.max(nextLapse - Date.now(), 0) + 1000,
    );

    return () => clearTimeout(timer);
  }, [nextLapse, queryClient, episodeId]);

  return { runs, isLive, refetch: query.refetch };
}
