'use client';

import { useEffect, useMemo, useState } from 'react';

import { addMinutes, format, isSameDay } from 'date-fns';
import {
  AlertCircle,
  ArrowLeft,
  Calendar as CalendarIcon,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Film,
  Languages,
  Loader2,
  Smartphone,
} from 'lucide-react';

import type { ActionResult } from '@kit/next/action-result';
import { Button } from '@kit/ui/button';
import { Calendar } from '@kit/ui/calendar';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@kit/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@kit/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@kit/ui/tooltip';

import type {
  BreakingPreview,
  ReleasePreview,
} from '../lib/cadence/release-types';
// =============================================================================
// Language Display - imported from shared constants
// =============================================================================

import { getLangDisplay } from '../lib/constants';
import { timeZoneLabel } from '../lib/time-zone-label';
import {
  BreakingReleaseForm,
  type BreakingSettings,
} from './breaking-release-form';
import { ReleaseCalendar } from './release-calendar';

// Types

export interface VideoToSchedule {
  type: 'full' | 'shorts';
  language: string;
  groupId?: string;
  groupName?: string;
  platforms: string[];
}

export interface ScheduleItem extends VideoToSchedule {
  scheduledAt: Date;
  /** Translated title for this language */
  title?: string;
  /** Translated description for this language */
  description?: string;
}

export interface ScheduleConfig {
  /**
   * FILM-719. 'cadence': each channel's posting rules pick the times, from
   * startDateTime on. 'stagger': item i goes at start + i × stagger.
   * FILM-2210 'breaking': ahead of every channel's queue, as `breaking` says.
   */
  mode: ReleaseMode;
  startDateTime: Date;
  staggerMinutes: number;
  schedule: ScheduleItem[];
  breaking?: BreakingSettings;
}

export type ReleaseMode = 'cadence' | 'stagger' | 'breaking';

/** One schedule item's key, shared with the targets built from it */
export function scheduleItemKey(item: VideoToSchedule) {
  return item.type === 'full'
    ? `full-${item.language}`
    : `group-${item.groupId}-${item.language}`;
}

interface ScheduleReleasePanelProps {
  /** Full video languages available (e.g., ['en', 'hi']) */
  fullVideoLanguages: string[];
  /** Shorts groups with their languages */
  shortsGroups: Array<{
    id: string;
    name: string;
    title?: string;
    description?: string;
    videoLanguages: string[];
  }>;
  /** Base metadata to translate */
  baseMetadata: {
    title: string;
    description: string;
  };
  /** Callback when user clicks "Schedule All" */
  onSchedule: (config: ScheduleConfig) => void;
  /** Callback when user clicks "Publish Now" */
  onPublishNow: () => void;
  /** Callback to trigger translations for languages */
  onTranslate?: (languages: string[]) => void;
  /** Translated metadata by item ID (e.g., 'full-video-hi', 'group-123-hi') */
  translatedMetadata?: Record<
    string,
    {
      title: string;
      description: string;
      contentType?: string;
      language?: string;
    }
  >;
  /** Is translation in progress */
  isTranslating?: boolean;
  /** Is publishing in progress */
  isPublishing?: boolean;
  /** Is scheduling in progress */
  isScheduling?: boolean;
  /** FILM-719: where the release would land on its channels; writes nothing */
  onPreviewCadence?: (
    startDateTime: Date,
    schedule: ScheduleItem[],
  ) => Promise<ActionResult<ReleasePreview>>;
  /** FILM-719: opens a channel's posting rules */
  onEditChannelCadence?: (connectionId: string) => void;
  /** FILM-2210: a breaking release's posts and what it moves; writes nothing */
  onPreviewBreaking?: (
    settings: BreakingSettings,
    schedule: ScheduleItem[],
  ) => Promise<ActionResult<BreakingPreview>>;
  /** KB-198: the project's channels are still being read; previews wait */
  channelsLoading?: boolean;
}

type CadencePreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; preview: ReleasePreview; forStart: number }
  | { status: 'error'; error: string };

// =============================================================================

// =============================================================================

// =============================================================================
// Schedule Calculation
// =============================================================================

function calculateSchedule(
  startDateTime: Date,
  staggerMinutes: number,
  fullVideoLanguages: string[],
  shortsGroups: Array<{
    id: string;
    name: string;
    videoLanguages: string[];
  }>,
): ScheduleItem[] {
  const schedule: ScheduleItem[] = [];

  // Sort languages alphabetically
  const sortedFullLangs = [...fullVideoLanguages].sort();

  // 1. Full videos first (sorted alphabetically by language)
  sortedFullLangs.forEach((lang) => {
    schedule.push({
      type: 'full',
      language: lang,
      platforms: [],
      scheduledAt: new Date(), // Will be calculated below
    });
  });

  // 2. Shorts groups (sorted by name, then languages alphabetically)
  const sortedGroups = [...shortsGroups].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  sortedGroups.forEach((group) => {
    const sortedLangs = [...group.videoLanguages].sort();
    sortedLangs.forEach((lang) => {
      schedule.push({
        type: 'shorts',
        language: lang,
        groupId: group.id,
        groupName: group.name,
        platforms: [],
        scheduledAt: new Date(), // Will be calculated below
      });
    });
  });

  // Calculate staggered times
  schedule.forEach((item, index) => {
    item.scheduledAt = addMinutes(startDateTime, index * staggerMinutes);
  });

  return schedule;
}

// =============================================================================
// Time Picker Component
// =============================================================================

function TimePicker({
  value,
  onChange,
  minTime,
}: {
  value: { hours: number; minutes: number };
  onChange: (value: { hours: number; minutes: number }) => void;
  minTime?: { hours: number; minutes: number } | null;
}) {
  const hours = Array.from({ length: 24 }, (_, i) => i).filter(
    (h) => !minTime || h >= minTime.hours,
  );

  const minutes = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

  // Filter minutes if the selected hour is the minimum hour
  const getFilteredMinutes = (selectedHour: number) => {
    if (!minTime || selectedHour > minTime.hours) return minutes;
    return minutes.filter((m) => m >= minTime.minutes);
  };

  return (
    <div className="flex items-center gap-2">
      <Select
        value={value.hours.toString().padStart(2, '0')}
        onValueChange={(h) => onChange({ ...value, hours: parseInt(h, 10) })}
      >
        <SelectTrigger className="w-20">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {hours.map((h) => (
            <SelectItem key={h} value={h.toString().padStart(2, '0')}>
              {h.toString().padStart(2, '0')}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-muted-foreground">:</span>
      <Select
        value={value.minutes.toString().padStart(2, '0')}
        onValueChange={(m) => onChange({ ...value, minutes: parseInt(m, 10) })}
      >
        <SelectTrigger className="w-20">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {getFilteredMinutes(value.hours).map((m) => (
            <SelectItem key={m} value={m.toString().padStart(2, '0')}>
              {m.toString().padStart(2, '0')}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function ScheduleReleasePanel({
  fullVideoLanguages,
  shortsGroups,
  baseMetadata,
  onSchedule,
  onPublishNow,
  onTranslate,
  translatedMetadata = {},
  isTranslating = false,
  isPublishing = false,
  isScheduling = false,
  onPreviewCadence,
  onEditChannelCadence,
  onPreviewBreaking,
  channelsLoading = false,
}: ScheduleReleasePanelProps) {
  // State
  const [mode, setMode] = useState<ReleaseMode>(
    onPreviewCadence ? 'cadence' : 'stagger',
  );
  const [cadencePreview, setCadencePreview] = useState<CadencePreviewState>({
    status: 'idle',
  });
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [time, setTime] = useState({ hours: 10, minutes: 0 });
  const [staggerMinutes, setStaggerMinutes] = useState(15);
  const [showPreview, setShowPreview] = useState(true);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [pendingBreaking, setPendingBreaking] =
    useState<BreakingSettings | null>(null);

  // Calculate minimum time if today is selected
  const minTime = useMemo(() => {
    if (date && isSameDay(date, new Date())) {
      const now = new Date();
      // Add a small buffer (e.g. 5 mins) so user doesn't select immediate past
      return { hours: now.getHours(), minutes: now.getMinutes() };
    }
    return null;
  }, [date]);

  // Ensure selected time is valid when date changes
  useEffect(() => {
    if (minTime) {
      if (
        time.hours < minTime.hours ||
        (time.hours === minTime.hours && time.minutes < minTime.minutes)
      ) {
        // Reset to next available slot
        // Round up to next 5 minutes
        const nextMinutes = Math.ceil(minTime.minutes / 5) * 5;
        if (nextMinutes < 60) {
          setTime({ hours: minTime.hours, minutes: nextMinutes });
        } else {
          setTime({ hours: minTime.hours + 1, minutes: 0 });
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minTime]);

  // Get user's local timezone
  const userTimezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return 'UTC';
    }
  }, []);

  // Get short timezone name (e.g., "IST", "PST")
  const timezoneShort = useMemo(
    () => timeZoneLabel(userTimezone),
    [userTimezone],
  );

  // Calculate total videos
  const totalVideos = useMemo(() => {
    const fullCount = fullVideoLanguages.length;
    const shortsCount = shortsGroups.reduce(
      (acc, g) => acc + g.videoLanguages.length,
      0,
    );
    return fullCount + shortsCount;
  }, [fullVideoLanguages, shortsGroups]);

  // Calculate schedule preview; a breaking release needs no start date
  const schedulePreview = useMemo(() => {
    if (!date && mode !== 'breaking') return [];

    const startDateTime = date ? new Date(date) : new Date();
    if (date) startDateTime.setHours(time.hours, time.minutes, 0, 0);

    return calculateSchedule(
      startDateTime,
      staggerMinutes,
      fullVideoLanguages,
      shortsGroups,
    );
  }, [date, time, mode, staggerMinutes, fullVideoLanguages, shortsGroups]);

  // Build list of all items to translate (Full Video + Shorts Groups, non-English only)
  const itemsToTranslate = useMemo(() => {
    const items: Array<{ id: string; label: string; language: string }> = [];

    // Full videos
    for (const lang of fullVideoLanguages) {
      if (lang !== 'en') {
        items.push({
          id: `full-video-${lang}`,
          label: 'Full Video',
          language: lang,
        });
      }
    }

    // Shorts groups
    for (const group of shortsGroups) {
      for (const lang of group.videoLanguages) {
        if (lang !== 'en') {
          items.push({
            id: `group-${group.id}-${lang}`,
            label: group.name || 'Shorts',
            language: lang,
          });
        }
      }
    }

    return items;
  }, [fullVideoLanguages, shortsGroups]);

  // Get unique languages (for backward compatibility)
  const languagesToTranslate = useMemo(() => {
    const allLangs = new Set(itemsToTranslate.map((item) => item.language));
    return [...allLangs].sort();
  }, [itemsToTranslate]);

  // Check translation status for each item
  const translationStatus = useMemo(() => {
    const status: Record<string, boolean> = {};
    itemsToTranslate.forEach((item) => {
      status[item.id] = !!translatedMetadata[item.id];
    });
    return status;
  }, [itemsToTranslate, translatedMetadata]);

  const allTranslated = useMemo(() => {
    return (
      itemsToTranslate.length === 0 ||
      itemsToTranslate.every((item) => translatedMetadata[item.id])
    );
  }, [itemsToTranslate, translatedMetadata]);

  // Calculate total duration
  const totalDuration = useMemo(() => {
    if (totalVideos <= 1) return 0;
    return (totalVideos - 1) * staggerMinutes;
  }, [totalVideos, staggerMinutes]);

  const releaseStart = useMemo(() => {
    if (!date) return null;

    const start = new Date(date);
    start.setHours(time.hours, time.minutes, 0, 0);
    return start;
  }, [date, time]);

  const cadenceMode = mode === 'cadence';
  const breakingMode = mode === 'breaking';
  // Three tabs share a narrow sidebar: their labels wrap
  const tabClass = onPreviewBreaking
    ? 'h-full whitespace-normal text-xs leading-tight'
    : undefined;
  const previewStale =
    cadencePreview.status === 'ready' &&
    cadencePreview.forStart !== releaseStart?.getTime();

  const labelOf = (itemKey: string) => {
    const item = schedulePreview.find((i) => scheduleItemKey(i) === itemKey);
    const language = getLangDisplay(item?.language ?? '').name;

    return {
      full: item?.type === 'full',
      label:
        item?.type === 'shorts'
          ? `Short: ${item.groupName} · ${language}`
          : `Full video · ${language}`,
    };
  };

  const handleCheckCalendar = async () => {
    if (!releaseStart || !onPreviewCadence) return;

    setCadencePreview({ status: 'loading' });

    try {
      const result = await onPreviewCadence(releaseStart, schedulePreview);

      setCadencePreview(
        result.ok
          ? {
              status: 'ready',
              preview: result.data,
              forStart: releaseStart.getTime(),
            }
          : { status: 'error', error: result.error },
      );
    } catch {
      setCadencePreview({
        status: 'error',
        error: 'Could not read the channels’ calendars. Try again.',
      });
    }
  };

  // Step 1: User clicks "Prepare Schedule" -> trigger translations
  const handlePrepareSchedule = () => {
    if (!date && !breakingMode) return;

    setShowConfirmation(true);

    // Trigger translations for non-English languages
    if (languagesToTranslate.length > 0 && onTranslate) {
      onTranslate(languagesToTranslate);
    }
  };

  // Step 2: User confirms -> build schedule with translations and submit
  const handleConfirmSchedule = (breaking = pendingBreaking) => {
    if (!date && !breakingMode) return;

    const startDateTime = date ? new Date(date) : new Date();
    if (date) startDateTime.setHours(time.hours, time.minutes, 0, 0);

    // Build schedule with translated metadata
    const scheduleWithTranslations = schedulePreview.map((item) => {
      const lookupKey =
        item.type === 'full'
          ? `full-video-${item.language}`
          : `group-${item.groupId}-${item.language}`;

      // For shorts, use group's own metadata as fallback (not baseMetadata)
      const group =
        item.type === 'shorts'
          ? shortsGroups.find((g) => g.id === item.groupId)
          : null;

      const fallbackTitle = group?.title || baseMetadata.title;
      const fallbackDescription =
        group?.description || baseMetadata.description;

      return {
        ...item,
        title: translatedMetadata[lookupKey]?.title || fallbackTitle,
        description:
          translatedMetadata[lookupKey]?.description || fallbackDescription,
      };
    });

    onSchedule({
      mode,
      startDateTime,
      staggerMinutes,
      schedule: scheduleWithTranslations,
      ...(breakingMode && breaking ? { breaking } : {}),
    });
  };

  // FILM-2210: the Breaking news tab schedules through the same two steps
  const handleScheduleBreaking = (settings: BreakingSettings) => {
    setPendingBreaking(settings);

    if (languagesToTranslate.length > 0) {
      handlePrepareSchedule();
      return;
    }

    handleConfirmSchedule(settings);
  };

  // No videos to schedule
  if (totalVideos === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-8">
          <div className="flex flex-col items-center text-center text-muted-foreground">
            <AlertCircle className="mb-2 h-8 w-8" />
            <p className="font-medium">No videos to schedule</p>
            <p className="text-sm">
              Upload videos in different languages first.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-test="schedule-release-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <CalendarIcon className="h-5 w-5" />
          Schedule Release
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {onPreviewCadence && (
          <div className="space-y-2">
            <Tabs
              value={mode}
              onValueChange={(value) => setMode(value as ReleaseMode)}
            >
              <TabsList
                className={`grid w-full ${onPreviewBreaking ? 'h-auto grid-cols-3' : 'grid-cols-2'}`}
              >
                <TabsTrigger
                  value="cadence"
                  className={tabClass}
                  data-test="release-mode-cadence"
                >
                  Channel cadence
                </TabsTrigger>
                <TabsTrigger
                  value="stagger"
                  className={tabClass}
                  data-test="release-mode-stagger"
                >
                  Custom
                </TabsTrigger>
                {onPreviewBreaking && (
                  <TabsTrigger
                    value="breaking"
                    className={tabClass}
                    data-test="release-mode-breaking"
                  >
                    Breaking news
                  </TabsTrigger>
                )}
              </TabsList>
            </Tabs>
            <p className="text-xs text-muted-foreground">
              {cadenceMode
                ? 'Each channel gets the long video in its next free slot, and the Shorts at the end of its Shorts queue, oldest episode first, never more a day than its Short times. Nothing lands in a burst.'
                : breakingMode
                  ? 'For news that cannot wait: the long video goes now or at your time, beside what is already scheduled, and its Shorts jump the queue with extra times for a few days.'
                  : 'Every video goes at the start time plus the stagger interval: they all land within hours.'}
            </p>
          </div>
        )}

        {breakingMode && onPreviewBreaking && !showConfirmation && (
          <BreakingReleaseForm
            disabled={isPublishing}
            channelsLoading={channelsLoading}
            isScheduling={isScheduling}
            labelOf={labelOf}
            onPreview={(settings) =>
              onPreviewBreaking(settings, schedulePreview)
            }
            onSchedule={handleScheduleBreaking}
          />
        )}

        {/* Date & Time Row: stacked, the card sits in a narrow sidebar */}
        <div className={breakingMode ? 'hidden' : 'grid gap-4'}>
          {/* Date Picker */}
          <div className="space-y-2">
            <Label>{cadenceMode ? 'Not before (date)' : 'Start Date'}</Label>
            <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full justify-start text-left font-normal"
                  data-test="release-date"
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date ? format(date, 'PPP') : 'Select date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(d) => {
                    setDate(d);
                    setIsCalendarOpen(false);
                  }}
                  disabled={(d) =>
                    d < new Date(new Date().setHours(0, 0, 0, 0))
                  }
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Time Picker */}
          <div className="space-y-2">
            <Label>{cadenceMode ? 'Not before (time)' : 'Start Time'}</Label>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <TimePicker value={time} onChange={setTime} minTime={minTime} />
            </div>
            <p className="text-xs text-muted-foreground">
              🌐 Times shown in your local timezone (
              {timezoneShort || userTimezone})
            </p>
          </div>
        </div>

        {/* Stagger Interval */}
        <div className={mode !== 'stagger' ? 'hidden' : 'space-y-2'}>
          <div className="flex items-center gap-2">
            <Label>Stagger Interval</Label>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <AlertCircle className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>
                    Time between each video upload to avoid spam detection.
                    Recommended: 15-30 minutes.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={1440}
              value={staggerMinutes}
              onChange={(e) =>
                setStaggerMinutes(Math.max(0, parseInt(e.target.value) || 0))
              }
              className="w-24"
            />
            <span className="text-sm text-muted-foreground">minutes</span>
            {staggerMinutes === 0 && (
              <span className="text-xs text-amber-500">
                ⚠️ Simultaneous upload may trigger spam detection
              </span>
            )}
          </div>
        </div>

        {/* FILM-719: the release on its channels' calendars */}
        {cadenceMode && date && (
          <div className="space-y-3 rounded-lg bg-muted/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">
                {totalVideos} video{totalVideos !== 1 ? 's' : ''} on each
                channel&apos;s calendar
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-test="release-check-calendar"
                data-loading={channelsLoading || undefined}
                aria-busy={channelsLoading}
                disabled={
                  channelsLoading || cadencePreview.status === 'loading'
                }
                onClick={handleCheckCalendar}
              >
                {(channelsLoading || cadencePreview.status === 'loading') && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {channelsLoading
                  ? 'Loading channels…'
                  : cadencePreview.status === 'ready'
                    ? 'Check again'
                    : 'Check channel calendars'}
              </Button>
            </div>

            {cadencePreview.status === 'error' && (
              <p
                className="text-sm text-destructive"
                data-test="release-calendar-error"
              >
                {cadencePreview.error}
              </p>
            )}

            {cadencePreview.status === 'ready' && (
              <>
                {previewStale && (
                  <p className="text-xs text-amber-600">
                    The date changed: check again to see where it lands.
                  </p>
                )}
                <ReleaseCalendar
                  preview={cadencePreview.preview}
                  labelOf={labelOf}
                  onEditChannel={onEditChannelCadence}
                />
              </>
            )}
          </div>
        )}

        {/* Summary */}
        {mode === 'stagger' && date && (
          <div className="rounded-lg bg-muted/50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">
                  {totalVideos} video{totalVideos !== 1 ? 's' : ''} scheduled
                </p>
                <p className="text-sm text-muted-foreground">
                  {format(schedulePreview[0]?.scheduledAt ?? date, 'PPp')} →{' '}
                  {format(
                    schedulePreview[schedulePreview.length - 1]?.scheduledAt ??
                      date,
                    'h:mm a',
                  )}
                  <span className="ml-2 text-xs">
                    (
                    {totalDuration >= 60
                      ? `${Math.floor(totalDuration / 60)}h ${totalDuration % 60}m`
                      : `${totalDuration}m`}{' '}
                    total)
                  </span>
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowPreview(!showPreview)}
              >
                {showPreview ? (
                  <>
                    Hide <ChevronUp className="ml-1 h-4 w-4" />
                  </>
                ) : (
                  <>
                    Preview <ChevronDown className="ml-1 h-4 w-4" />
                  </>
                )}
              </Button>
            </div>

            {/* Schedule Preview List */}
            {showPreview && schedulePreview.length > 0 && (
              <div className="mt-4 max-h-64 space-y-2 overflow-y-auto">
                {schedulePreview.map((item, index) => {
                  const langInfo = getLangDisplay(item.language);
                  return (
                    <div
                      key={`${item.type}-${item.groupId ?? ''}-${item.language}`}
                      className="flex items-center justify-between rounded-md bg-background px-3 py-2"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-6 text-xs text-muted-foreground">
                          {index + 1}.
                        </span>
                        {item.type === 'full' ? (
                          <Film className="h-4 w-4 text-primary" />
                        ) : (
                          <Smartphone className="h-4 w-4 text-pink-500" />
                        )}
                        <span className="text-lg">{langInfo.flag}</span>
                        <div>
                          <span className="font-medium">{langInfo.name}</span>
                          <span className="ml-2 text-xs text-muted-foreground">
                            {item.type === 'full'
                              ? 'Full Video'
                              : `Short: ${item.groupName}`}
                          </span>
                        </div>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {format(item.scheduledAt, 'h:mm a')}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Confirmation Panel - Step 2 */}
        {showConfirmation && (
          <div className="rounded-lg bg-muted/50 p-4">
            <div className="mb-4 flex items-center gap-2">
              <Languages className="h-5 w-5" />
              <h4 className="font-medium">Translation Status</h4>
            </div>

            {isTranslating ? (
              <div className="flex items-center gap-2 py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">
                  Translating {itemsToTranslate.length} item
                  {itemsToTranslate.length !== 1 ? 's' : ''}...
                </span>
              </div>
            ) : (
              <div className="mb-4 space-y-2">
                {itemsToTranslate.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Only English videos - no translation needed.
                  </p>
                ) : (
                  itemsToTranslate.map((item) => {
                    const langInfo = getLangDisplay(item.language);
                    const isReady = translationStatus[item.id];
                    const translated = translatedMetadata[item.id];
                    return (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 rounded-md bg-background p-3"
                      >
                        <span className="text-lg">{langInfo.flag}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">
                            {translated?.title || baseMetadata.title}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {item.label} · {langInfo.name}
                          </p>
                        </div>
                        {isReady ? (
                          <Check className="h-4 w-4 text-green-500" />
                        ) : (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowConfirmation(false)}
                disabled={isScheduling}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <Button
                variant="default"
                size="sm"
                className="flex-1"
                data-test="release-confirm-schedule"
                disabled={!allTranslated || isScheduling}
                onClick={() => handleConfirmSchedule()}
              >
                {isScheduling ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Scheduling...
                  </>
                ) : (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    Confirm & Schedule
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Action Buttons - Step 1 */}
        {!showConfirmation && (
          <div className="flex flex-col gap-3">
            <Button
              variant="default"
              className={breakingMode ? 'hidden' : 'flex-1'}
              data-test="release-schedule"
              disabled={!date || isScheduling || isPublishing}
              onClick={
                languagesToTranslate.length > 0
                  ? handlePrepareSchedule
                  : () => handleConfirmSchedule()
              }
            >
              {isScheduling ? (
                <>
                  <Clock className="mr-2 h-4 w-4 animate-spin" />
                  Scheduling...
                </>
              ) : languagesToTranslate.length > 0 ? (
                <>
                  <Languages className="mr-2 h-4 w-4" />
                  Prepare Schedule
                </>
              ) : (
                <>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {cadenceMode ? 'Schedule on channel cadence' : 'Schedule All'}
                </>
              )}
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              disabled={isScheduling || isPublishing}
              onClick={onPublishNow}
            >
              {isPublishing ? (
                <>
                  <Clock className="mr-2 h-4 w-4 animate-spin" />
                  Publishing...
                </>
              ) : (
                'Publish Now'
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
