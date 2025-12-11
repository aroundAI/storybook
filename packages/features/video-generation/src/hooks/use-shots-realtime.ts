'use client';

import { useEffect, useRef } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { useSupabase } from '@kit/supabase/hooks/use-supabase';
import { toast } from '@kit/ui/sonner';

import { shotsQueryKeys } from './use-shots-query';

/**
 * Realtime shot update payload
 */
interface ShotRealtimePayload {
  id: string;
  episode_id: string;
  shot_number: number;
  sequence_number: number | null;
  status: 'pending' | 'queued' | 'generating' | 'completed' | 'failed';
  video_url: string | null;
}

/**
 * Options for the useShotsRealtime hook
 */
interface UseShotsRealtimeOptions {
  /** Episode ID to subscribe to */
  episodeId: string;
  /** Whether to enable the subscription (default: true) */
  enabled?: boolean;
  /** Callback when a shot is updated (should be memoized with useCallback) */
  onShotUpdate?: (shot: ShotRealtimePayload) => void;
  /** Whether to show toast notifications (default: true) */
  showNotifications?: boolean;
}

/**
 * Hook to subscribe to real-time shot updates via Supabase Realtime
 *
 * Automatically invalidates the shots query cache when updates occur
 * and optionally shows toast notifications for status changes.
 *
 * @param options - Configuration options
 */
export function useShotsRealtime({
  episodeId,
  enabled = true,
  onShotUpdate,
  showNotifications = true,
}: UseShotsRealtimeOptions) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();

  // Use refs to avoid recreating the channel when callbacks change
  // This prevents memory leaks from multiple subscriptions
  const onShotUpdateRef = useRef(onShotUpdate);
  const showNotificationsRef = useRef(showNotifications);

  // Keep refs in sync with latest values
  useEffect(() => {
    onShotUpdateRef.current = onShotUpdate;
  }, [onShotUpdate]);

  useEffect(() => {
    showNotificationsRef.current = showNotifications;
  }, [showNotifications]);

  useEffect(() => {
    if (!enabled || !episodeId) return;

    const channel = supabase
      .channel(`shots:episode:${episodeId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'shots',
          filter: `episode_id=eq.${episodeId}`,
        },
        (payload) => {
          // Invalidate shots query to refetch data
          queryClient.invalidateQueries({
            queryKey: shotsQueryKeys.byEpisode(episodeId),
          });

          // Handle status-specific notifications
          const newData = payload.new as ShotRealtimePayload | undefined;
          const oldData = payload.old as ShotRealtimePayload | undefined;

          if (newData && showNotificationsRef.current) {
            // Only show notification if status changed
            if (oldData?.status !== newData.status) {
              const shotLabel = `Shot ${newData.sequence_number ?? newData.shot_number}`;

              switch (newData.status) {
                case 'completed':
                  toast.success(`${shotLabel} video generated successfully`);
                  break;
                case 'failed':
                  toast.error(`${shotLabel} generation failed`);
                  break;
                case 'generating':
                  // Silent - user already knows generation started
                  break;
                case 'queued':
                  // Silent - batch operations would create too many toasts
                  break;
              }
            }
          }

          // Call optional callback via ref
          if (newData) {
            onShotUpdateRef.current?.(newData);
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [episodeId, enabled, supabase, queryClient]);
}
