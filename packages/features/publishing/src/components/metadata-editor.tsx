'use client';

import type { ChangeEvent } from 'react';
import { useCallback, useMemo, useState } from 'react';

import { format } from 'date-fns';
import {
  AlertTriangle,
  Calendar as CalendarIcon,
  Facebook,
  Instagram,
  Plus,
  X,
  Youtube,
} from 'lucide-react';

import { Alert, AlertDescription } from '@kit/ui/alert';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Calendar } from '@kit/ui/calendar';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@kit/ui/popover';
import { Textarea } from '@kit/ui/textarea';

import { PLATFORM_CONFIG, PLATFORM_LIMITS } from '../lib/platform-limits';
import { tweetLength } from '../lib/tweet-length';
import type {
  MetadataEditorProps,
  Platform,
  ValidationResult,
} from '../lib/types';
import { PlatformSpecificSettingsComponent } from './platform-specific-settings';
import { ThumbnailSelector } from './thumbnail-selector';

/**
 * TikTok icon
 */
function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
    </svg>
  );
}

/**
 * X (Twitter) icon
 */
function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

const PLATFORM_ICONS: Record<Platform, React.ReactNode> = {
  youtube: <Youtube className="h-5 w-5 text-red-500" />,
  tiktok: <TikTokIcon className="h-5 w-5" />,
  instagram: <Instagram className="h-5 w-5 text-pink-500" />,
  facebook: <Facebook className="h-5 w-5 text-blue-600" />,
  twitter: <XIcon className="h-5 w-5" />,
};

export function MetadataEditor({
  platform,
  onChange,
  videoPreviewUrl,
}: MetadataEditorProps) {
  const limits = PLATFORM_LIMITS[platform.platform];
  const config = PLATFORM_CONFIG[platform.platform];
  const [tagInput, setTagInput] = useState('');
  const isTweet = platform.platform === 'twitter';
  const titleLength = isTweet
    ? tweetLength(platform.title)
    : platform.title.length;

  // Validation
  const validation = useMemo<ValidationResult>(() => {
    const warnings: string[] = [];
    const errors: string[] = [];

    if (titleLength > limits.titleMax) {
      errors.push(`Title exceeds ${limits.titleMax} characters`);
    }

    if (
      platform.description.length > limits.descriptionMax &&
      limits.descriptionMax > 0
    ) {
      errors.push(`Description exceeds ${limits.descriptionMax} characters`);
    }

    // Platform-specific warnings
    if (platform.platform === 'youtube') {
      if (platform.title.length < 20 && platform.title.length > 0) {
        warnings.push('Short titles may get less engagement');
      }
      if (platform.tags.length === 0) {
        warnings.push('Adding tags improves discoverability');
      }
    }

    // Hashtag counting for TikTok/Instagram
    if (platform.platform === 'tiktok' || platform.platform === 'instagram') {
      const hashtagCount = (platform.title.match(/#/g) || []).length;
      if (hashtagCount > limits.tagsMax) {
        errors.push(`Maximum ${limits.tagsMax} hashtags allowed`);
      }
    }

    return { warnings, errors, isValid: errors.length === 0 };
  }, [platform, limits, titleLength]);

  const handleAddTag = useCallback(() => {
    if (!tagInput.trim()) return;
    const newTag = tagInput.trim().replace(/^#/, '');
    if (!platform.tags.includes(newTag)) {
      onChange({ tags: [...platform.tags, newTag] });
    }
    setTagInput('');
  }, [tagInput, platform.tags, onChange]);

  const handleRemoveTag = useCallback(
    (tag: string) => {
      onChange({ tags: platform.tags.filter((t) => t !== tag) });
    },
    [platform.tags, onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddTag();
      }
    },
    [handleAddTag],
  );

  const handleScheduledDateChange = useCallback(
    (date: Date | undefined) => {
      onChange({ scheduledAt: date });
    },
    [onChange],
  );

  const handleClearSchedule = useCallback(() => {
    onChange({ scheduledAt: undefined });
  }, [onChange]);

  // Determine if this platform uses caption (title only) or title + description
  const usesCaption = limits.descriptionMax === 0;
  const titleLabel = usesCaption ? 'Caption' : 'Title';

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          {PLATFORM_ICONS[platform.platform]}
          <span>{config.name} Settings</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Validation Alerts */}
        {validation.errors.length > 0 && (
          <Alert variant="destructive">
            <AlertDescription>
              <ul className="list-disc pl-4">
                {validation.errors.map((error: string, i: number) => (
                  <li key={i}>{error}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {validation.warnings.length > 0 && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <ul className="list-disc pl-4">
                {validation.warnings.map((warning: string, i: number) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {/* Left Column: Text Fields */}
          <div className="space-y-4">
            {/* Title / Caption */}
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label htmlFor={`${platform.platform}-title`}>
                  {titleLabel}
                </Label>
                <span
                  className={
                    titleLength > limits.titleMax
                      ? 'text-sm text-destructive'
                      : 'text-sm text-muted-foreground'
                  }
                  data-test={`${platform.platform}-title-count`}
                >
                  {titleLength}/{limits.titleMax}
                </span>
              </div>
              {usesCaption ? (
                <Textarea
                  id={`${platform.platform}-title`}
                  value={platform.title}
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                    onChange({ title: e.target.value })
                  }
                  rows={4}
                  maxLength={isTweet ? undefined : limits.titleMax}
                  placeholder={`Enter ${platform.platform} caption...`}
                />
              ) : (
                <Input
                  id={`${platform.platform}-title`}
                  value={platform.title}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    onChange({ title: e.target.value })
                  }
                  maxLength={isTweet ? undefined : limits.titleMax}
                  placeholder={`Enter ${platform.platform} title...`}
                />
              )}
            </div>

            {/* Description (if supported) */}
            {limits.descriptionMax > 0 && (
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label htmlFor={`${platform.platform}-description`}>
                    Description
                  </Label>
                  <span className="text-sm text-muted-foreground">
                    {platform.description.length}/{limits.descriptionMax}
                  </span>
                </div>
                <Textarea
                  id={`${platform.platform}-description`}
                  value={platform.description}
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                    onChange({ description: e.target.value })
                  }
                  rows={4}
                  maxLength={limits.descriptionMax}
                  placeholder="Enter description..."
                />
              </div>
            )}

            {/* Tags (YouTube only) */}
            {limits.tagsMax > 0 && platform.platform === 'youtube' && (
              <div className="space-y-2">
                <Label>Tags</Label>
                <div className="flex gap-2">
                  <Input
                    value={tagInput}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setTagInput(e.target.value)
                    }
                    onKeyDown={handleKeyDown}
                    placeholder="Add tag..."
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleAddTag}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {platform.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {platform.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="gap-1">
                        {tag}
                        <button
                          type="button"
                          onClick={() => handleRemoveTag(tag)}
                          className="hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Scheduling */}
            {limits.schedulingSupported && (
              <div className="space-y-2">
                <Label>Publish Time</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {platform.scheduledAt
                        ? format(platform.scheduledAt, 'PPP p')
                        : 'Publish immediately'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={platform.scheduledAt}
                      onSelect={handleScheduledDateChange}
                      disabled={(date) => date < new Date()}
                    />
                    <div className="border-t p-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleClearSchedule}
                      >
                        Clear (Publish Now)
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            )}
          </div>

          {/* Right Column: Thumbnail & Platform Settings */}
          <div className="space-y-4">
            {/* Thumbnail */}
            <ThumbnailSelector
              currentUrl={platform.thumbnailUrl}
              videoUrl={videoPreviewUrl}
              onChange={(url) => onChange({ thumbnailUrl: url })}
            />

            {/* Platform-Specific Settings */}
            <PlatformSpecificSettingsComponent
              platform={platform.platform}
              settings={platform.platformSpecific}
              onChange={(updates) =>
                onChange({
                  platformSpecific: {
                    ...platform.platformSpecific,
                    ...updates,
                  },
                })
              }
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
