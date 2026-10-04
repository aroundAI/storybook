'use client';

import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clapperboard, Smartphone } from 'lucide-react';

import { type RenderPreset, isVerticalRender } from '@kit/desktop-integration';
import type { ShortsGroup } from '@kit/episodes/types';
import { LANG_INFO, getLangDisplay } from '@kit/publishing/lib/constants';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';

import {
  type EpisodeRender,
  listEpisodeRendersAction,
} from '../_lib/server/list-episode-renders.action';

const PRESET_LABEL: Record<RenderPreset, string> = {
  youtube_16x9: 'YouTube 16:9',
  shorts_9x16: 'YouTube Shorts 9:16',
  tiktok_9x16: 'TikTok 9:16',
  reels_9x16: 'Reels 9:16',
  square_1x1: 'Square 1:1',
  master: 'Master',
};

function presetLabel(preset: string) {
  return PRESET_LABEL[preset as RenderPreset] ?? preset;
}

function duration(seconds: number) {
  const whole = Math.round(Number(seconds));

  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function fileSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface PublishRenderPickerProps {
  episodeId: string;
  /** The delivered primary render's URL (episodes.final_video_url) */
  finalVideoUrl: string | null;
  localizedVideos: Record<string, string>;
  shortsGroups: ShortsGroup[];
  isPending: boolean;
  onUseAsFullVideo: (language: string, url: string) => void;
  onAddAsShort: (language: string, url: string, label: string) => void;
}

/**
 * The episode's StorybookStudio renders on the publish page (FILM-2003).
 * The primary render is the default publish target of its language
 * (deliver_edit puts it there); any 16:9, square or master render can be
 * made the full video of its language, and a 9:16 render added as a Short
 * for TikTok, Reels and YouTube Shorts. The manual uploads below stay.
 */
export function PublishRenderPicker({
  episodeId,
  finalVideoUrl,
  localizedVideos,
  shortsGroups,
  isPending,
  onUseAsFullVideo,
  onAddAsShort,
}: PublishRenderPickerProps) {
  const { data: renders } = useQuery({
    queryKey: ['episode-renders', episodeId],
    queryFn: async () =>
      (await listEpisodeRendersAction({ episodeId })).renders,
  });

  if (!renders || renders.length === 0) {
    return null;
  }

  const isPrimary = (render: EpisodeRender) =>
    render.file_url === finalVideoUrl;

  const ordered = [...renders].sort(
    (a, b) =>
      Number(isPrimary(b)) - Number(isPrimary(a)) ||
      a.language.localeCompare(b.language) ||
      a.preset.localeCompare(b.preset),
  );

  const inShorts = new Set(
    shortsGroups.flatMap((group) => Object.values(group.videos)),
  );

  return (
    <Card data-test="render-picker">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Clapperboard className="h-5 w-5 text-indigo-500" />
          Studio renders
        </CardTitle>
        <CardDescription>
          Delivered from StorybookStudio. The primary render is the default
          video for its language; vertical renders can go out as Shorts. You can
          still upload a file yourself below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {ordered.map((render) => (
          <RenderRow
            key={render.id}
            render={render}
            primary={isPrimary(render)}
            inUse={localizedVideos[render.language] === render.file_url}
            inShorts={inShorts.has(render.file_url)}
            isPending={isPending}
            onUseAsFullVideo={onUseAsFullVideo}
            onAddAsShort={onAddAsShort}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function RenderRow({
  render,
  primary,
  inUse,
  inShorts,
  isPending,
  onUseAsFullVideo,
  onAddAsShort,
}: {
  render: EpisodeRender;
  primary: boolean;
  inUse: boolean;
  inShorts: boolean;
  isPending: boolean;
  onUseAsFullVideo: (language: string, url: string) => void;
  onAddAsShort: (language: string, url: string, label: string) => void;
}) {
  const language = getLangDisplay(render.language);
  const supported = Object.hasOwn(LANG_INFO, render.language);
  const vertical = isVerticalRender(render);
  const issues = render.qa.issues?.length ?? 0;
  const label = `${presetLabel(render.preset)} · ${language.name}`;

  return (
    <div
      data-test="render-row"
      data-render-id={render.id}
      data-preset={render.preset}
      data-language={render.language}
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700"
    >
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          {vertical ? (
            <Smartphone className="h-4 w-4 text-gray-500" />
          ) : (
            <Clapperboard className="h-4 w-4 text-gray-500" />
          )}
          <span className="font-medium" data-test="render-label">
            {label}
          </span>
          {primary && (
            <Badge data-test="render-primary" variant="default">
              Primary
            </Badge>
          )}
          {render.qa.pass === false || issues > 0 ? (
            <Badge data-test="render-qa" variant="secondary">
              {issues} QA {issues === 1 ? 'issue' : 'issues'}
            </Badge>
          ) : (
            <Badge data-test="render-qa" variant="outline">
              QA passed
            </Badge>
          )}
        </div>
        <p className="text-sm text-gray-500" data-test="render-facts">
          {render.aspect} · {duration(render.duration_seconds)} ·{' '}
          {fileSize(render.file_size_bytes)}
          {vertical && ' · for TikTok, Reels and YouTube Shorts'}
        </p>
      </div>

      {vertical ? (
        inShorts ? (
          <Badge data-test="render-in-shorts" variant="outline">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            In Shorts
          </Badge>
        ) : (
          <Button
            size="sm"
            variant="outline"
            data-test="render-add-short"
            disabled={isPending || !supported}
            onClick={() =>
              onAddAsShort(render.language, render.file_url, label)
            }
          >
            Add as a Short
          </Button>
        )
      ) : inUse ? (
        <Badge data-test="render-in-use" variant="outline">
          <CheckCircle2 className="mr-1 h-3 w-3" />
          {language.name} full video
        </Badge>
      ) : (
        <Button
          size="sm"
          variant="outline"
          data-test="render-use-full"
          disabled={isPending || !supported}
          onClick={() => onUseAsFullVideo(render.language, render.file_url)}
        >
          Use as {language.name} full video
        </Button>
      )}
    </div>
  );
}
