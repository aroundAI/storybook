---
spec_id: FILM-710
status: 🗑️ RETIRED
audited: 2026-09-23
---

# FILM-710: Metadata Editor

> **🗑️ Retired (audit 2026-09-23).** `MetadataEditor` (with `ThumbnailSelector` and `PlatformSpecificSettingsComponent`) was rendered only inside `PublishHub`, which no page has rendered since baa752eb (2026-01-06) switched the `/publish` route to `PublishScreen`; the components are still in `packages/features/publishing/src/components/`, unused. In `apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/publish/_components/`, the publish screen takes one title, description and tag list for every channel (`publish-settings-sidebar.tsx:52`), translates it per language (`publish-screen.tsx:907`), schedules through `ScheduleReleasePanel` (`publish-screen.tsx:1431`) and takes one thumbnail per language (`video-card.tsx:88`). It has no per-platform settings, character counters or validation, and every YouTube upload goes out as category 22, not made for kids (`packages/features/publishing/src/server/publish-actions.ts:682`, `:685`) — tracked as KB-30. Kept as a record; not outstanding work.

## Metadata
- **Phase:** 7 - Publishing
- **Priority:** P1 (Post-MVP)
- **Effort:** M (4-8 hours)
- **Status:** 🗑️ RETIRED (audit 2026-09-23; was ✅ DONE)
- **Dependencies:** FILM-701-704 (Platform Providers)
- **Blocks:** FILM-708 (Publish Hub)

---

## Context

The Metadata Editor allows customizing title, description, tags, and platform-specific settings for each platform. It handles character limits, hashtag formatting, and platform constraints.

---

## Specification

### Requirements

1. **Title/Description**: Editable with character counters
2. **Tags/Hashtags**: Platform-appropriate formatting
3. **Thumbnail**: Preview and upload custom
4. **Scheduling**: Date/time picker for scheduled posts
5. **Platform Settings**: YouTube categories, TikTok toggles, etc.
6. **Validation**: Real-time validation with warnings

### Component Interface

```typescript
// packages/features/publishing/src/components/metadata-editor.tsx

interface MetadataEditorProps {
  platform: PlatformPublishConfig;
  onChange: (updates: Partial<PlatformPublishConfig>) => void;
  videoPreviewUrl: string;
}

// Platform-specific constraints
const PLATFORM_LIMITS = {
  youtube: {
    titleMax: 100,
    descriptionMax: 5000,
    tagsMax: 500, // Total characters for all tags
  },
  tiktok: {
    titleMax: 2200, // Caption
    descriptionMax: 0, // No separate description
    tagsMax: 100, // Number of hashtags
  },
  instagram: {
    titleMax: 2200, // Caption includes description
    descriptionMax: 0,
    tagsMax: 30, // Number of hashtags
  },
  facebook: {
    titleMax: 255,
    descriptionMax: 63206,
    tagsMax: 0, // No tags
  },
};
```

### Component Implementation

```tsx
// packages/features/publishing/src/components/metadata-editor.tsx

'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Input } from '@kit/ui/input';
import { Textarea } from '@kit/ui/textarea';
import { Label } from '@kit/ui/label';
import { Button } from '@kit/ui/button';
import { Badge } from '@kit/ui/badge';
import { Switch } from '@kit/ui/switch';
import { Calendar } from '@kit/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@kit/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@kit/ui/select';
import { Alert, AlertDescription } from '@kit/ui/alert';
import {
  Youtube,
  Instagram,
  Facebook,
  Calendar as CalendarIcon,
  Image as ImageIcon,
  X,
  Plus,
  AlertTriangle,
} from 'lucide-react';
import { format } from 'date-fns';

import { ThumbnailSelector } from './thumbnail-selector';

const YOUTUBE_CATEGORIES = [
  { id: '1', name: 'Film & Animation' },
  { id: '22', name: 'People & Blogs' },
  { id: '23', name: 'Comedy' },
  { id: '24', name: 'Entertainment' },
  { id: '27', name: 'Education' },
  { id: '28', name: 'Science & Technology' },
];

export function MetadataEditor({
  platform,
  onChange,
  videoPreviewUrl,
}: MetadataEditorProps) {
  const limits = PLATFORM_LIMITS[platform.platform];
  const [tagInput, setTagInput] = useState('');

  // Validation
  const validation = useMemo(() => {
    const warnings: string[] = [];
    const errors: string[] = [];

    if (platform.title.length > limits.titleMax) {
      errors.push(`Title exceeds ${limits.titleMax} characters`);
    }

    if (platform.description.length > limits.descriptionMax && limits.descriptionMax > 0) {
      errors.push(`Description exceeds ${limits.descriptionMax} characters`);
    }

    // Platform-specific warnings
    if (platform.platform === 'youtube') {
      if (platform.title.length < 20) {
        warnings.push('Short titles may get less engagement');
      }
      if (!platform.tags.length) {
        warnings.push('Adding tags improves discoverability');
      }
    }

    if (platform.platform === 'tiktok' || platform.platform === 'instagram') {
      const hashtagCount = (platform.title.match(/#/g) || []).length;
      if (hashtagCount > limits.tagsMax) {
        errors.push(`Maximum ${limits.tagsMax} hashtags allowed`);
      }
    }

    return { warnings, errors, isValid: errors.length === 0 };
  }, [platform, limits]);

  const handleAddTag = () => {
    if (!tagInput.trim()) return;
    const newTag = tagInput.trim().replace(/^#/, '');
    if (!platform.tags.includes(newTag)) {
      onChange({ tags: [...platform.tags, newTag] });
    }
    setTagInput('');
  };

  const handleRemoveTag = (tag: string) => {
    onChange({ tags: platform.tags.filter(t => t !== tag) });
  };

  const platformIcon = {
    youtube: <Youtube className="h-5 w-5 text-red-500" />,
    tiktok: <span className="text-lg">🎵</span>,
    instagram: <Instagram className="h-5 w-5 text-pink-500" />,
    facebook: <Facebook className="h-5 w-5 text-blue-600" />,
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          {platformIcon[platform.platform]}
          <span className="capitalize">{platform.platform}</span> Settings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Validation Alerts */}
        {validation.errors.length > 0 && (
          <Alert variant="destructive">
            <AlertDescription>
              <ul className="list-disc pl-4">
                {validation.errors.map((error, i) => (
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
                {validation.warnings.map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {/* Left Column: Text Fields */}
          <div className="space-y-4">
            {/* Title */}
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label htmlFor={`${platform.platform}-title`}>
                  {platform.platform === 'tiktok' || platform.platform === 'instagram'
                    ? 'Caption'
                    : 'Title'}
                </Label>
                <span className="text-sm text-muted-foreground">
                  {platform.title.length}/{limits.titleMax}
                </span>
              </div>
              <Input
                id={`${platform.platform}-title`}
                value={platform.title}
                onChange={(e) => onChange({ title: e.target.value })}
                maxLength={limits.titleMax}
                placeholder={`Enter ${platform.platform} title...`}
              />
            </div>

            {/* Description (if supported) */}
            {limits.descriptionMax > 0 && (
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label htmlFor={`${platform.platform}-description`}>Description</Label>
                  <span className="text-sm text-muted-foreground">
                    {platform.description.length}/{limits.descriptionMax}
                  </span>
                </div>
                <Textarea
                  id={`${platform.platform}-description`}
                  value={platform.description}
                  onChange={(e) => onChange({ description: e.target.value })}
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
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
                    placeholder="Add tag..."
                    className="flex-1"
                  />
                  <Button type="button" variant="secondary" onClick={handleAddTag}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
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
              </div>
            )}

            {/* Scheduling */}
            <div className="space-y-2">
              <Label>Publish Time</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {platform.scheduledAt
                      ? format(new Date(platform.scheduledAt), 'PPP p')
                      : 'Publish immediately'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={platform.scheduledAt ? new Date(platform.scheduledAt) : undefined}
                    onSelect={(date) =>
                      onChange({ scheduledAt: date?.toISOString() })
                    }
                    disabled={(date) => date < new Date()}
                  />
                  <div className="p-3 border-t">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onChange({ scheduledAt: undefined })}
                    >
                      Clear (Publish Now)
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
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
            <PlatformSpecificSettings
              platform={platform.platform}
              settings={platform.platformSpecific}
              onChange={(updates) =>
                onChange({ platformSpecific: { ...platform.platformSpecific, ...updates } })
              }
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface PlatformSpecificSettingsProps {
  platform: string;
  settings: Record<string, any>;
  onChange: (updates: Record<string, any>) => void;
}

function PlatformSpecificSettings({
  platform,
  settings,
  onChange,
}: PlatformSpecificSettingsProps) {
  switch (platform) {
    case 'youtube':
      return (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Category</Label>
            <Select
              value={settings.categoryId || '22'}
              onValueChange={(value) => onChange({ categoryId: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {YOUTUBE_CATEGORIES.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Privacy</Label>
            <Select
              value={settings.privacy || 'private'}
              onValueChange={(value) => onChange({ privacy: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">Private</SelectItem>
                <SelectItem value="unlisted">Unlisted</SelectItem>
                <SelectItem value="public">Public</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="made-for-kids">Made for kids</Label>
            <Switch
              id="made-for-kids"
              checked={settings.madeForKids || false}
              onCheckedChange={(checked) => onChange({ madeForKids: checked })}
            />
          </div>
        </div>
      );

    case 'tiktok':
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Allow Duet</Label>
              <p className="text-xs text-muted-foreground">Let others create Duets</p>
            </div>
            <Switch
              checked={!settings.disableDuet}
              onCheckedChange={(checked) => onChange({ disableDuet: !checked })}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Allow Stitch</Label>
              <p className="text-xs text-muted-foreground">Let others create Stitches</p>
            </div>
            <Switch
              checked={!settings.disableStitch}
              onCheckedChange={(checked) => onChange({ disableStitch: !checked })}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Allow Comments</Label>
              <p className="text-xs text-muted-foreground">Let viewers comment</p>
            </div>
            <Switch
              checked={!settings.disableComment}
              onCheckedChange={(checked) => onChange({ disableComment: !checked })}
            />
          </div>
        </div>
      );

    case 'instagram':
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Share to Feed</Label>
              <p className="text-xs text-muted-foreground">Also show on your profile grid</p>
            </div>
            <Switch
              checked={settings.shareToFeed ?? true}
              onCheckedChange={(checked) => onChange({ shareToFeed: checked })}
            />
          </div>
        </div>
      );

    case 'facebook':
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Post as Reel</Label>
              <p className="text-xs text-muted-foreground">Short-form vertical video</p>
            </div>
            <Switch
              checked={settings.isReel || false}
              onCheckedChange={(checked) => onChange({ isReel: checked })}
            />
          </div>
        </div>
      );

    default:
      return null;
  }
}
```

### File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/publishing/src/components/metadata-editor.tsx` |
| CREATE | `packages/features/publishing/src/components/thumbnail-selector.tsx` |

---

## Acceptance Criteria

- [ ] Title/description fields show character counters
- [ ] Validation errors show when limits exceeded
- [ ] Warnings show for suboptimal content
- [ ] Tags can be added/removed (YouTube)
- [ ] Hashtags counted in caption (TikTok/Instagram)
- [ ] Scheduling calendar works
- [ ] YouTube categories selectable
- [ ] TikTok Duet/Stitch toggles work
- [ ] Instagram share-to-feed toggle works
- [ ] Thumbnail can be changed
- [ ] Platform-specific UI renders correctly

---

## Test Plan

### Unit Tests
- [ ] Test character limit validation
- [ ] Test hashtag counting
- [ ] Test tag add/remove

### Integration Tests
- [ ] Test platform settings persistence

---

## Accessibility

- Labels associated with inputs
- Error messages announced
- Calendar is keyboard accessible
- Toggle switches have labels
