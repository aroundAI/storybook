'use client';

import { useMemo, useState } from 'react';

import { useQuery } from '@tanstack/react-query';

import {
  type ActionResult,
  refusalMessage,
  unwrap,
} from '@kit/next/action-result';
import {
  ChannelCadenceDialog,
  type ChannelCadenceState,
} from '@kit/publishing/components';
import {
  type ReleasePreview,
  releaseTargetKey,
} from '@kit/publishing/lib/cadence/release-types';
import {
  discardHeldShortsAction,
  getChannelCadencesAction,
  previewCadenceReleaseAction,
  requeueHeldShortsAction,
  scheduleCadenceReleaseAction,
} from '@kit/publishing/server';
import { toast } from '@kit/ui/sonner';

import type { PlatformConfig } from './publish-types';

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
 * FILM-719. The Publish screen's cadence release: where a release would land
 * on its channels' calendars, scheduling it there, a channel's posting
 * rules, and the Shorts a release held back.
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

  const preview = async (
    configs: ReleaseConfig[],
    notBefore: Date,
  ): Promise<ActionResult<ReleasePreview>> => {
    try {
      return {
        ok: true,
        data: await unwrap(
          previewCadenceReleaseAction(release(configs, notBefore)),
        ),
      };
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

  const schedule = async (configs: ReleaseConfig[], notBefore: Date) => {
    try {
      const result = await unwrap(
        scheduleCadenceReleaseAction(release(configs, notBefore)),
      );
      const parts = [`Scheduled ${result.scheduled.length} uploads`];

      if (result.held.length > 0) {
        parts.push(
          `${result.held.length} held: they don't fit before the next episode`,
        );
      }
      if (result.displaced.length > 0) {
        parts.push(
          `${result.displaced.length} of an earlier episode's Shorts held back`,
        );
      }

      toast.success(parts.join(' · '));
      props.onChanged();
    } catch (error) {
      toast.error(refusalMessage(error, 'Could not schedule the release.'));
    }
  };

  const requeueHeld = async (publishIds: string[]) => {
    try {
      const result = await unwrap(
        requeueHeldShortsAction({ publishIds, timezone }),
      );
      toast.success(
        result.stillHeld.length
          ? `Re-queued ${result.requeued.length}; ${result.stillHeld.length} found no free slot`
          : `Re-queued ${result.requeued.length} Short${result.requeued.length === 1 ? '' : 's'}`,
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
