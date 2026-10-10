'use client';

import { Plus, Smartphone, Trash2, Upload, X } from 'lucide-react';

import type { ShortsGroup, ShortsPlatform } from '@kit/episodes/types';
import type { SupportedLanguage } from '@kit/publishing/lib/constants';
import {
  LANG_INFO,
  SHORTS_PLATFORMS,
  takesVideo,
} from '@kit/publishing/lib/constants';
import { shortsTargets } from '@kit/publishing/lib/shorts-targets';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Input } from '@kit/ui/input';
import { cn } from '@kit/ui/utils';

import { PlatformIcon } from './platform-ui';
import { PLATFORM_CONFIG, type PlatformConnection } from './publish-types';

interface ShortsSectionProps {
  shortsGroups: ShortsGroup[];
  /** The project's channels: who receives each group */
  channels: PlatformConnection[];
  onAddGroup: () => void;
  onUpdateGroupMetadata: (
    groupId: string,
    updates: Partial<
      Pick<ShortsGroup, 'title' | 'description' | 'tags' | 'name' | 'platforms'>
    >,
  ) => void;
  onDeleteGroup: (groupId: string) => void;
  onDeleteVideoFromGroup: (groupId: string, language: string) => void;
  onOpenUploadDialog: (type: 'shorts', groupId: string) => void;
}

export function ShortsSection({
  shortsGroups,
  channels,
  onAddGroup,
  onUpdateGroupMetadata,
  onDeleteGroup,
  onDeleteVideoFromGroup,
  onOpenUploadDialog,
}: ShortsSectionProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Smartphone className="h-5 w-5 text-pink-500" />
            Shorts / Reels
            <Badge variant="outline" className="ml-2 text-xs">
              {shortsGroups.length} group
              {shortsGroups.length !== 1 ? 's' : ''}
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onAddGroup}
              className="border-pink-300 text-pink-600 hover:bg-pink-50"
            >
              <Plus className="mr-1 h-4 w-4" />
              New Group
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {shortsGroups.length === 0 ? (
          <button
            onClick={onAddGroup}
            className="flex w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 p-8 text-gray-500 transition-colors hover:border-pink-400 hover:bg-pink-50 hover:text-pink-600 dark:border-gray-600 dark:bg-gray-800/50"
          >
            <Upload className="h-8 w-8" />
            <span className="font-medium">Create First Shorts Group</span>
            <span className="text-sm text-gray-400">
              Each group has its own metadata that gets translated
            </span>
          </button>
        ) : (
          shortsGroups.map((group, groupIndex) => (
            <div
              key={group.id}
              data-test="shorts-group"
              data-group-id={group.id}
              className="overflow-hidden rounded-lg border border-border"
            >
              {/* Group Header */}
              <div className="border-b border-border bg-gradient-to-r from-pink-50 to-purple-50 p-3 dark:from-pink-900/20 dark:to-purple-900/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-pink-600 dark:text-pink-400">
                      Group {groupIndex + 1}
                    </span>
                    <Input
                      value={group.name}
                      onChange={(e) =>
                        onUpdateGroupMetadata(group.id, {
                          name: e.target.value,
                        })
                      }
                      className="h-7 w-32 border-pink-200 text-xs"
                      placeholder="Group name"
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDeleteGroup(group.id)}
                    className="h-7 w-7 p-0 text-red-500 hover:bg-red-50 hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <GroupPlatforms
                group={group}
                channels={channels}
                onChange={(platforms) =>
                  onUpdateGroupMetadata(group.id, { platforms })
                }
              />

              {/* Group Metadata */}
              <div className="space-y-2 bg-gray-50/50 p-3 dark:bg-gray-800/30">
                <div>
                  <label className="text-xs font-medium text-gray-500">
                    Title
                  </label>
                  <Input
                    value={group.title}
                    onChange={(e) =>
                      onUpdateGroupMetadata(group.id, {
                        title: e.target.value,
                      })
                    }
                    className="h-8 text-sm"
                    placeholder="Title for this shorts group"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500">
                    Description
                  </label>
                  <textarea
                    value={group.description}
                    onChange={(e) =>
                      onUpdateGroupMetadata(group.id, {
                        description: e.target.value,
                      })
                    }
                    className="min-h-[60px] w-full rounded-md border border-border bg-card p-2 text-sm"
                    placeholder="Description for this group (will be translated per language)"
                  />
                </div>
              </div>

              {/* Group Videos */}
              <div className="p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  {Object.entries(group.videos).map(
                    ([lang, url]) =>
                      url && (
                        <div
                          key={lang}
                          className="group/video relative overflow-hidden rounded-lg border border-border"
                        >
                          <video
                            src={url}
                            className="aspect-[9/16] w-full bg-black object-cover"
                            controls
                          />
                          <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-black/70 px-2 py-1 text-xs text-white">
                            <span>
                              {LANG_INFO[lang as SupportedLanguage]?.flag}
                            </span>
                            <span>
                              {LANG_INFO[lang as SupportedLanguage]?.name}
                            </span>
                          </div>
                          {/* Delete video button */}
                          <button
                            onClick={() =>
                              onDeleteVideoFromGroup(group.id, lang)
                            }
                            className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-colors group-hover/video:opacity-100 hover:bg-red-600"
                            title={`Remove ${LANG_INFO[lang as SupportedLanguage]?.name || lang} video`}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ),
                  )}
                  <button
                    onClick={() => onOpenUploadDialog('shorts', group.id)}
                    className="flex aspect-[9/16] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 text-gray-500 transition-colors hover:border-pink-400 hover:bg-pink-50 hover:text-pink-600 dark:border-gray-600 dark:bg-gray-800/50 dark:hover:border-pink-500 dark:hover:bg-gray-700/50 dark:hover:text-pink-400"
                  >
                    <Plus className="h-6 w-6" />
                    <span className="text-sm font-medium">Add Language</span>
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

const OFFERED_SHORTS_PLATFORMS = SHORTS_PLATFORMS.filter((platform) =>
  takesVideo('short', platform),
);

/** Which platforms a group's cut is for, and the channels that receive it */
function GroupPlatforms({
  group,
  channels,
  onChange,
}: {
  group: ShortsGroup;
  channels: PlatformConnection[];
  onChange: (platforms: ShortsPlatform[]) => void;
}) {
  const chosen = group.platforms ?? [];
  const targets = shortsTargets([group], channels);
  const languages = Object.keys(group.videos).filter(
    (lang) => group.videos[lang],
  );
  const unreached = chosen.filter(
    (platform) => !targets.some(({ channel }) => channel.platform === platform),
  );

  const toggle = (platform: ShortsPlatform) =>
    onChange(
      chosen.includes(platform)
        ? chosen.filter((p) => p !== platform)
        : [...chosen, platform],
    );

  return (
    <div className="space-y-2 border-b border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-500">Goes to</span>
        {OFFERED_SHORTS_PLATFORMS.map((platform) => {
          const on = chosen.includes(platform);

          return (
            <button
              key={platform}
              type="button"
              aria-pressed={on}
              data-test="shorts-group-platform"
              data-platform={platform}
              data-state={on ? 'on' : 'off'}
              onClick={() => toggle(platform)}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
                on
                  ? 'border-pink-500 bg-pink-500 text-white'
                  : 'border-border text-muted-foreground hover:border-pink-300',
              )}
            >
              {PLATFORM_CONFIG[platform]?.name ?? platform}
            </button>
          );
        })}
        {chosen.length === 0 && (
          <span className="text-xs text-muted-foreground">
            All Shorts platforms
          </span>
        )}
      </div>

      {languages.length > 0 && (
        <div
          data-test="shorts-group-targets"
          className="flex flex-wrap items-center gap-1.5 text-xs"
        >
          <span className="text-gray-500">Receives this group:</span>
          {targets.length === 0 ? (
            <span className="text-amber-600">No channel of this project</span>
          ) : (
            targets.map(({ channel, language }) => (
              <span
                key={`${channel.id}-${language}`}
                data-test="shorts-group-target"
                data-channel-id={channel.id}
                className="flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5"
              >
                <PlatformIcon platform={channel.platform} size="sm" />
                {channel.platformAccountName}
                <span className="text-muted-foreground uppercase">
                  {language}
                </span>
              </span>
            ))
          )}
        </div>
      )}

      {languages.length > 0 &&
        unreached.map((platform) => (
          <p key={platform} className="text-xs text-amber-600">
            No {PLATFORM_CONFIG[platform]?.name ?? platform} channel in this
            project takes{' '}
            {languages
              .map((lang) => LANG_INFO[lang as SupportedLanguage]?.name ?? lang)
              .join(' or ')}
            .
          </p>
        ))}
    </div>
  );
}
