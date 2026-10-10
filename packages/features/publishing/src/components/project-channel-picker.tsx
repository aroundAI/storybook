'use client';

import { useState, useTransition } from 'react';

import { Loader2, Search } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Checkbox } from '@kit/ui/checkbox';
import { Input } from '@kit/ui/input';
import { toast } from '@kit/ui/sonner';

import { setProjectChannelsAction } from '../server/project-publishing-actions';

export interface PickableChannel {
  id: string;
  platform: string;
  platformAccountName: string | null;
  language: string | null;
}

interface ProjectChannelPickerProps {
  projectId: string;
  /** Every channel connected to the team */
  channels: PickableChannel[];
  /** The ids of the channels the project publishes to now */
  selectedIds: string[];
  /** Where a channel's language is changed */
  channelSettingsUrl?: string;
  onSaved?: (connectionIds: string[]) => void;
}

const PLATFORM_LABELS: Record<string, string> = {
  youtube: 'YouTube',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  twitter: 'X',
};

const SEARCH_THRESHOLD = 8;

const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });

function languageLabel(code: string | null) {
  const language = code ?? 'en';

  try {
    return languageNames.of(language) ?? language.toUpperCase();
  } catch {
    return language.toUpperCase();
  }
}

/**
 * Chooses the channels a project's episodes publish to. A channel receives
 * the language version set on the channel itself.
 */
export function ProjectChannelPicker({
  projectId,
  channels,
  selectedIds,
  channelSettingsUrl,
  onSaved,
}: ProjectChannelPickerProps) {
  const [isSaving, startSaving] = useTransition();
  const [state, setState] = useState(() => ({
    saved: new Set(selectedIds),
    selected: new Set(selectedIds),
    query: '',
  }));

  const query = state.query.trim().toLowerCase();
  const visible = channels.filter(
    (channel) =>
      !query ||
      (channel.platformAccountName ?? '').toLowerCase().includes(query) ||
      channel.platform.includes(query),
  );
  const byPlatform = new Map<string, PickableChannel[]>();
  for (const channel of visible) {
    byPlatform.set(channel.platform, [
      ...(byPlatform.get(channel.platform) ?? []),
      channel,
    ]);
  }

  const hasChanges =
    state.selected.size !== state.saved.size ||
    [...state.selected].some((id) => !state.saved.has(id));

  const toggle = (id: string, checked: boolean) =>
    setState((prev) => {
      const selected = new Set(prev.selected);
      if (checked) selected.add(id);
      else selected.delete(id);
      return { ...prev, selected };
    });

  const save = () =>
    startSaving(async () => {
      const connectionIds = [...state.selected];
      const result = await setProjectChannelsAction({
        projectId,
        connectionIds,
      });

      if (!result.success) {
        toast.error(result.error ?? "Couldn't save this project's channels");
        return;
      }

      setState((prev) => ({ ...prev, saved: new Set(connectionIds) }));
      toast.success(
        `This project publishes to ${connectionIds.length} channel${connectionIds.length === 1 ? '' : 's'}`,
      );
      onSaved?.(connectionIds);
    });

  if (channels.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No channels are connected to this team yet.
        {channelSettingsUrl && (
          <>
            {' '}
            <a href={channelSettingsUrl} className="text-primary underline">
              Connect one
            </a>
            .
          </>
        )}
      </p>
    );
  }

  return (
    <div className="space-y-4" data-test="project-channel-picker">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {state.selected.size} of {channels.length} channels selected
        </p>
        <Button
          size="sm"
          onClick={save}
          disabled={!hasChanges || isSaving}
          data-test="project-channels-save"
        >
          {isSaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          Save channels
        </Button>
      </div>

      {channels.length > SEARCH_THRESHOLD && (
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={state.query}
            onChange={(event) =>
              setState((prev) => ({ ...prev, query: event.target.value }))
            }
            placeholder="Search channels"
            className="pl-8"
            data-test="project-channels-search"
          />
        </div>
      )}

      <div className="space-y-4">
        {[...byPlatform].map(([platform, platformChannels]) => (
          <div key={platform} className="space-y-1">
            <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {PLATFORM_LABELS[platform] ?? platform}
            </h4>
            <div className="divide-y divide-border rounded-md border">
              {platformChannels.map((channel) => (
                <label
                  key={channel.id}
                  className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/50"
                >
                  <Checkbox
                    checked={state.selected.has(channel.id)}
                    onCheckedChange={(checked) =>
                      toggle(channel.id, checked === true)
                    }
                    data-test="project-channel-checkbox"
                    data-channel-id={channel.id}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {channel.platformAccountName || channel.platform}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {languageLabel(channel.language)}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
        {visible.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No channel matches “{state.query}”.
          </p>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Each channel receives the video in its own language.
        {channelSettingsUrl && (
          <>
            {' '}
            <a href={channelSettingsUrl} className="text-primary underline">
              Change a channel&apos;s language
            </a>
            .
          </>
        )}
      </p>
    </div>
  );
}
