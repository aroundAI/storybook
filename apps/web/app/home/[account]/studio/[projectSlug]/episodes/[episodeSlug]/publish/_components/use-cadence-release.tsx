'use client';

import { useMemo, useState } from 'react';

import { useQuery } from '@tanstack/react-query';

import {
  type ActionResult,
  refusalMessage,
  unwrap,
} from '@kit/next/action-result';
import {
  type BreakingSettings,
  ChannelCadenceDialog,
  type ChannelCadenceState,
} from '@kit/publishing/components';
import { YOUTUBE_UPLOADS_PER_DAY } from '@kit/publishing/lib/cadence/plan-breaking-release';
import {
  type BreakingPreview,
  QUEUE_WARNING_DAYS,
  type ReleasePreview,
  releaseTargetKey,
} from '@kit/publishing/lib/cadence/release-types';
import {
  discardHeldShortsAction,
  getChannelCadencesAction,
  previewBreakingReleaseAction,
  previewCadenceReleaseAction,
  requeueHeldShortsAction,
  scheduleBreakingReleaseAction,
  scheduleCadenceReleaseAction,
} from '@kit/publishing/server';
import { toast } from '@kit/ui/sonner';

import type { PlatformConfig } from './publish-types';

/** No channel of the episode's project takes any of its uploaded videos */
export const NO_MATCHING_CHANNELS =
  'No matching channels for uploaded videos. Check language settings.';

/** The project's channels have not been read yet */
export const CHANNELS_LOADING =
  'The channels are still loading. Check again in a moment.';

/** A target of the release: one schedule item on one channel */
export type ReleaseConfig = PlatformConfig & { itemKey: string };

function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function targetsOf(configs: ReleaseConfig[]) {
  return configs.map(({ itemKey, platform: _platform, ...config }) => ({
    ...config,
    key: releaseTargetKey(itemKey, config.connectionId),
  }));
}

/**
 * FILM-719, FILM-2209. The Publish screen's cadence release: where a release
 * would land on its channels' calendars, scheduling it there, a channel's
 * posting rules, and Shorts an earlier release held back. FILM-2210: the
 * same for a breaking release, which goes ahead of the queue.
 */
export function useCadenceRelease(props: {
  episodeId: string;
  aiGenerated: boolean;
  channels: ReadonlyArray<{ id: string; platformAccountName: string }>;
  onChanged: () => void;
}) {
  const timezone = useMemo(browserTimeZone, []);
  const [editing, setEditing] = useState<string | null>(null);

  const release = (configs: ReleaseConfig[], notBefore: Date) => ({
    episodeId: props.episodeId,
    targets: targetsOf(configs),
    notBefore: notBefore.toISOString(),
    timezone,
    aiGenerated: props.aiGenerated,
  });

  /** A preview of a release's configs: cadence or breaking */
  const previewWith = async <T,>(
    configs: ReleaseConfig[],
    read: () => Promise<T>,
  ): Promise<ActionResult<T>> => {
    // Nothing to place is the caller's state, not a failed read
    if (configs.length === 0) {
      return { ok: false, error: NO_MATCHING_CHANNELS };
    }

    try {
      return { ok: true, data: await read() };
    } catch (error) {
      return {
        ok: false,
        error: refusalMessage(
          error,
          'Could not read the channels’ calendars. Try again.',
        ),
      };
    }
  };

  const preview = (
    configs: ReleaseConfig[],
    notBefore: Date,
  ): Promise<ActionResult<ReleasePreview>> =>
    previewWith(configs, () =>
      unwrap(previewCadenceReleaseAction(release(configs, notBefore))),
    );

  const schedule = async (configs: ReleaseConfig[], notBefore: Date) => {
    try {
      const result = await unwrap(
        scheduleCadenceReleaseAction(release(configs, notBefore)),
      );
      const behind = result.shortsQueue.filter((queue) => queue.runsAhead);

      toast.success(`Scheduled ${result.scheduled.length} uploads`);
      if (behind.length > 0) {
        toast.warning(
          `The Shorts queue on ${behind.map((queue) => queue.name).join(', ')} runs more than ${QUEUE_WARNING_DAYS} days past the last long video. Add Short times, or post long videos less often.`,
        );
      }
      props.onChanged();
    } catch (error) {
      toast.error(refusalMessage(error, 'Could not schedule the release.'));
    }
  };

  const breakingRelease = (
    configs: ReleaseConfig[],
    settings: BreakingSettings,
  ) => ({
    ...release(configs, new Date()),
    breaking: {
      ...(settings.at ? { at: settings.at.toISOString() } : {}),
      boost: { extraPerDay: settings.extraPerDay, days: settings.days },
    },
  });

  const previewBreaking = (
    configs: ReleaseConfig[],
    settings: BreakingSettings,
  ): Promise<ActionResult<BreakingPreview>> =>
    previewWith(configs, () =>
      unwrap(previewBreakingReleaseAction(breakingRelease(configs, settings))),
    );

  const scheduleBreaking = async (
    configs: ReleaseConfig[],
    settings: BreakingSettings,
  ) => {
    try {
      const result = await unwrap(
        scheduleBreakingReleaseAction(breakingRelease(configs, settings)),
      );

      toast.success(
        `Scheduled ${result.scheduled.length} breaking uploads; ${result.moves.length} queued Short${result.moves.length === 1 ? '' : 's'} moved back`,
      );
      if (result.quota.length > 0) {
        toast.warning(
          `More than ${YOUTUBE_UPLOADS_PER_DAY} YouTube uploads on ${result.quota.map((q) => q.day).join(', ')}: uploads past the daily quota fail until it resets.`,
        );
      }
      props.onChanged();
    } catch (error) {
      toast.error(
        refusalMessage(error, 'Could not schedule the breaking release.'),
      );
    }
  };

  const requeueHeld = async (publishIds: string[]) => {
    try {
      const result = await unwrap(
        requeueHeldShortsAction({ publishIds, timezone }),
      );
      toast.success(
        `Re-queued ${result.requeued.length} Short${result.requeued.length === 1 ? '' : 's'}`,
      );
      props.onChanged();
    } catch (error) {
      toast.error(refusalMessage(error, 'Could not re-queue the Shorts.'));
    }
  };

  const discardHeld = async (publishIds: string[]) => {
    try {
      const result = await unwrap(
        discardHeldShortsAction({ publishIds, timezone }),
      );
      toast.success(
        `Discarded ${result.discarded.length} held Short${result.discarded.length === 1 ? '' : 's'}`,
      );
      props.onChanged();
    } catch (error) {
      toast.error(refusalMessage(error, 'Could not discard the Shorts.'));
    }
  };

  const channel = props.channels.find((c) => c.id === editing);
  const dialog = channel ? (
    <CadenceRulesDialog
      channel={{ id: channel.id, name: channel.platformAccountName }}
      timezone={timezone}
      onClose={() => setEditing(null)}
    />
  ) : null;

  return {
    preview,
    schedule,
    previewBreaking,
    scheduleBreaking,
    requeueHeld,
    discardHeld,
    editChannel: setEditing,
    dialog,
  };
}

function CadenceRulesDialog(props: {
  channel: { id: string; name: string };
  timezone: string;
  onClose: () => void;
}) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['channel-cadences', props.channel.id],
    queryFn: () =>
      getChannelCadencesAction({ connectionIds: [props.channel.id] }),
  });

  if (isLoading || !data) return null;

  return (
    <ChannelCadenceDialog
      channel={props.channel}
      cadences={data as ChannelCadenceState[]}
      defaultTimezone={props.timezone}
      onSaved={() => {
        toast.success('Posting rules saved. Check the calendars again.');
        void refetch();
        props.onClose();
      }}
      onCancel={props.onClose}
    />
  );
}
