'use client';

import { useRef, useState } from 'react';

import { YouTubeAudienceDialog } from '@kit/publishing/components/youtube-audience-dialog';
import type { YouTubeDeclaration } from '@kit/publishing/lib/youtube-declaration';

import type { PlatformConnection } from './publish-types';

interface PendingQuestion {
  channels: PlatformConnection[];
  resolve: (declared: boolean) => void;
}

/**
 * KB-30. Nothing is sent to a YouTube channel until the creator has said who
 * it is for. `ensureDeclared` resolves at once when every target channel has
 * answered; otherwise it asks, and resolves `false` if they cancel.
 *
 * Answers are also kept here, because the connections query refetches after
 * the dialog saves and the publish continues before that lands.
 */
export function useYouTubeAudienceGate(onDeclared: () => void) {
  const [pending, setPending] = useState<PendingQuestion | null>(null);
  const answered = useRef(new Map<string, YouTubeDeclaration>());

  const declarationOf = (
    channel: PlatformConnection,
  ): YouTubeDeclaration | undefined => {
    const answer = answered.current.get(channel.id);
    if (answer) return answer;

    if (
      typeof channel.youtubeMadeForKids === 'boolean' &&
      channel.youtubeCategoryId
    ) {
      return {
        madeForKids: channel.youtubeMadeForKids,
        categoryId: channel.youtubeCategoryId,
      };
    }

    return undefined;
  };

  const ensureDeclared = (targets: PlatformConnection[]) => {
    const undeclared = targets.filter(
      (channel) => channel.platform === 'youtube' && !declarationOf(channel),
    );

    if (undeclared.length === 0) return Promise.resolve(true);

    return new Promise<boolean>((resolve) =>
      setPending({ channels: undeclared, resolve }),
    );
  };

  /** What a config for this channel carries: the declaration, for YouTube. */
  const platformSpecificFor = (
    channel: PlatformConnection,
    base: Record<string, unknown> = {},
  ): Record<string, unknown> =>
    channel.platform === 'youtube'
      ? { ...base, ...declarationOf(channel) }
      : base;

  const dialog = pending ? (
    <YouTubeAudienceDialog
      channels={pending.channels.map((channel) => ({
        id: channel.id,
        name: channel.platformAccountName,
      }))}
      onCancel={() => {
        pending.resolve(false);
        setPending(null);
      }}
      onSaved={(answers) => {
        for (const { connectionId, ...declaration } of answers) {
          answered.current.set(connectionId, declaration);
        }
        pending.resolve(true);
        setPending(null);
        onDeclared();
      }}
    />
  ) : null;

  return { ensureDeclared, platformSpecificFor, declarationOf, dialog };
}
