'use client';

import { useMemo } from 'react';

import { useQuery } from '@tanstack/react-query';

import { getChannelCadencesAction } from '../server/schedule-release-actions';
import {
  ChannelCadenceDialog,
  type ChannelCadenceState,
} from './channel-cadence-dialog';

function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * FILM-2211. One channel's posting rules, read and opened in the dialog:
 * from an episode's Publish screen, the Schedule page and Settings →
 * Platforms alike. The rules are the channel's, whichever opens them.
 */
export function ChannelPostingRulesDialog(props: {
  channel: { id: string; name: string; platform: string };
  onSaved: () => void;
  onClose: () => void;
}) {
  const timezone = useMemo(browserTimeZone, []);
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
      defaultTimezone={timezone}
      onSaved={() => {
        void refetch();
        props.onSaved();
        props.onClose();
      }}
      onCancel={props.onClose}
    />
  );
}
