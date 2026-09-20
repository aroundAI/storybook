'use client';

import { useQuery } from '@tanstack/react-query';

import { listChannelsAction } from '../server/channels-actions';

/**
 * A project's channels, shared by every tab that filters by one.
 *
 * One query key, so the Deep Dive and the Video Log read the same cached
 * list rather than fetching it twice and disagreeing while one is stale.
 * The selected channel itself lives in the dashboard, above both tabs.
 */
export function useProjectChannels(projectId: string) {
  return useQuery({
    queryKey: ['analytics-channels', projectId],
    queryFn: () => listChannelsAction({ projectId }),
  });
}
