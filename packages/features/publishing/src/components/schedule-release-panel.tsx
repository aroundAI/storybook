'use client';

import { useMemo, useState } from 'react';

import { format, addMinutes } from 'date-fns';
import {
    Calendar as CalendarIcon,
    Clock,
    AlertCircle,
    ChevronDown,
    ChevronUp,
    Film,
    Smartphone,
} from 'lucide-react';

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
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@kit/ui/tooltip';

// =============================================================================
// Types
// =============================================================================

export interface VideoToSchedule {
    type: 'full' | 'shorts';
    language: string;
    groupId?: string;
    groupName?: string;
    platforms: string[];
}

export interface ScheduleItem extends VideoToSchedule {
    scheduledAt: Date;
}

export interface ScheduleConfig {
    startDateTime: Date;
    staggerMinutes: number;
    schedule: ScheduleItem[];
}

interface ScheduleReleasePanelProps {
    /** Full video languages available (e.g., ['en', 'hi']) */
    fullVideoLanguages: string[];
    /** Shorts groups with their languages */
    shortsGroups: Array<{
        id: string;
        name: string;
        videoLanguages: string[];
    }>;
    /** Callback when user clicks "Schedule All" */
    onSchedule: (config: ScheduleConfig) => void;
    /** Callback when user clicks "Publish Now" */
    onPublishNow: () => void;
    /** Is publishing in progress */
    isPublishing?: boolean;
    /** Is scheduling in progress */
    isScheduling?: boolean;
}

// =============================================================================
// Language Display
// =============================================================================

const LANG_INFO: Record<string, { name: string; flag: string }> = {
    en: { name: 'English', flag: '🇺🇸' },
    hi: { name: 'Hindi', flag: '🇮🇳' },
    es: { name: 'Spanish', flag: '🇪🇸' },
    pt: { name: 'Portuguese', flag: '🇧🇷' },
    fr: { name: 'French', flag: '🇫🇷' },
    de: { name: 'German', flag: '🇩🇪' },
    ja: { name: 'Japanese', flag: '🇯🇵' },
    ko: { name: 'Korean', flag: '🇰🇷' },
    zh: { name: 'Chinese', flag: '🇨🇳' },
};

function getLangDisplay(lang: string) {
    return LANG_INFO[lang] || { name: lang.toUpperCase(), flag: '🌐' };
}

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
}: {
    value: { hours: number; minutes: number };
    onChange: (value: { hours: number; minutes: number }) => void;
}) {
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const minutes = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

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
                    {minutes.map((m) => (
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
    onSchedule,
    onPublishNow,
    isPublishing = false,
    isScheduling = false,
}: ScheduleReleasePanelProps) {
    // State
    const [date, setDate] = useState<Date | undefined>(undefined);
    const [time, setTime] = useState({ hours: 10, minutes: 0 });
    const [staggerMinutes, setStaggerMinutes] = useState(15);
    const [showPreview, setShowPreview] = useState(true);

    // Calculate total videos
    const totalVideos = useMemo(() => {
        const fullCount = fullVideoLanguages.length;
        const shortsCount = shortsGroups.reduce(
            (acc, g) => acc + g.videoLanguages.length,
            0,
        );
        return fullCount + shortsCount;
    }, [fullVideoLanguages, shortsGroups]);

    // Calculate schedule preview
    const schedulePreview = useMemo(() => {
        if (!date) return [];

        const startDateTime = new Date(date);
        startDateTime.setHours(time.hours, time.minutes, 0, 0);

        return calculateSchedule(
            startDateTime,
            staggerMinutes,
            fullVideoLanguages,
            shortsGroups,
        );
    }, [date, time, staggerMinutes, fullVideoLanguages, shortsGroups]);

    // Calculate total duration
    const totalDuration = useMemo(() => {
        if (totalVideos <= 1) return 0;
        return (totalVideos - 1) * staggerMinutes;
    }, [totalVideos, staggerMinutes]);

    // Handle schedule
    const handleSchedule = () => {
        if (!date) return;

        const startDateTime = new Date(date);
        startDateTime.setHours(time.hours, time.minutes, 0, 0);

        onSchedule({
            startDateTime,
            staggerMinutes,
            schedule: schedulePreview,
        });
    };

    // No videos to schedule
    if (totalVideos === 0) {
        return (
            <Card className="border-dashed">
                <CardContent className="py-8">
                    <div className="text-muted-foreground flex flex-col items-center text-center">
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
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                    <CalendarIcon className="h-5 w-5" />
                    Schedule Release
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* Date & Time Row */}
                <div className="grid gap-4 sm:grid-cols-2">
                    {/* Date Picker */}
                    <div className="space-y-2">
                        <Label>Start Date</Label>
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    className="w-full justify-start text-left font-normal"
                                >
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {date ? format(date, 'PPP') : 'Select date'}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                                <Calendar
                                    mode="single"
                                    selected={date}
                                    onSelect={setDate}
                                    disabled={(d) => d < new Date(new Date().setHours(0, 0, 0, 0))}
                                    initialFocus
                                />
                            </PopoverContent>
                        </Popover>
                    </div>

                    {/* Time Picker */}
                    <div className="space-y-2">
                        <Label>Start Time</Label>
                        <div className="flex items-center gap-2">
                            <Clock className="text-muted-foreground h-4 w-4" />
                            <TimePicker value={time} onChange={setTime} />
                        </div>
                    </div>
                </div>

                {/* Stagger Interval */}
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <Label>Stagger Interval</Label>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger>
                                    <AlertCircle className="text-muted-foreground h-4 w-4" />
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
                        <span className="text-muted-foreground text-sm">minutes</span>
                        {staggerMinutes === 0 && (
                            <span className="text-amber-500 text-xs">
                                ⚠️ Simultaneous upload may trigger spam detection
                            </span>
                        )}
                    </div>
                </div>

                {/* Summary */}
                {date && (
                    <div className="bg-muted/50 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="font-medium">
                                    {totalVideos} video{totalVideos !== 1 ? 's' : ''} scheduled
                                </p>
                                <p className="text-muted-foreground text-sm">
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
                                            className="bg-background flex items-center justify-between rounded-md px-3 py-2"
                                        >
                                            <div className="flex items-center gap-3">
                                                <span className="text-muted-foreground w-6 text-xs">
                                                    {index + 1}.
                                                </span>
                                                {item.type === 'full' ? (
                                                    <Film className="text-primary h-4 w-4" />
                                                ) : (
                                                    <Smartphone className="text-pink-500 h-4 w-4" />
                                                )}
                                                <span className="text-lg">{langInfo.flag}</span>
                                                <div>
                                                    <span className="font-medium">{langInfo.name}</span>
                                                    <span className="text-muted-foreground ml-2 text-xs">
                                                        {item.type === 'full'
                                                            ? 'Full Video'
                                                            : `Short: ${item.groupName}`}
                                                    </span>
                                                </div>
                                            </div>
                                            <span className="text-muted-foreground text-sm">
                                                {format(item.scheduledAt, 'h:mm a')}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* Action Buttons */}
                <div className="flex flex-col gap-3 sm:flex-row">
                    <Button
                        variant="default"
                        className="flex-1"
                        disabled={!date || isScheduling || isPublishing}
                        onClick={handleSchedule}
                    >
                        {isScheduling ? (
                            <>
                                <Clock className="mr-2 h-4 w-4 animate-spin" />
                                Scheduling...
                            </>
                        ) : (
                            <>
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                Schedule All
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
            </CardContent>
        </Card>
    );
}
