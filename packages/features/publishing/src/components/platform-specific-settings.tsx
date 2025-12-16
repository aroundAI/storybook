'use client';

import { Label } from '@kit/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { Switch } from '@kit/ui/switch';

import { YOUTUBE_CATEGORIES } from '../lib/platform-limits';
import type { Platform, PlatformSpecificSettings } from '../lib/types';

interface PlatformSpecificSettingsComponentProps {
  platform: Platform;
  settings: PlatformSpecificSettings;
  onChange: (updates: Partial<PlatformSpecificSettings>) => void;
}

export function PlatformSpecificSettingsComponent({
  platform,
  settings,
  onChange,
}: PlatformSpecificSettingsComponentProps) {
  switch (platform) {
    case 'youtube':
      return <YouTubeSettings settings={settings} onChange={onChange} />;
    case 'tiktok':
      return <TikTokSettings settings={settings} onChange={onChange} />;
    case 'instagram':
      return <InstagramSettings settings={settings} onChange={onChange} />;
    case 'facebook':
      return <FacebookSettings settings={settings} onChange={onChange} />;
    case 'twitter':
    case 'linkedin':
    default:
      return null;
  }
}

interface SettingsProps {
  settings: PlatformSpecificSettings;
  onChange: (updates: Partial<PlatformSpecificSettings>) => void;
}

function YouTubeSettings({ settings, onChange }: SettingsProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Category</Label>
        <Select
          value={settings.categoryId ?? '22'}
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
          value={settings.privacy ?? 'private'}
          onValueChange={(value) =>
            onChange({ privacy: value as 'private' | 'unlisted' | 'public' })
          }
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
        <div>
          <Label htmlFor="made-for-kids">Made for kids</Label>
          <p className="text-muted-foreground text-xs">
            Content made specifically for children
          </p>
        </div>
        <Switch
          id="made-for-kids"
          checked={settings.madeForKids ?? false}
          onCheckedChange={(checked) => onChange({ madeForKids: checked })}
        />
      </div>
    </div>
  );
}

function TikTokSettings({ settings, onChange }: SettingsProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Label>Allow Duet</Label>
          <p className="text-muted-foreground text-xs">
            Let others create Duets with this video
          </p>
        </div>
        <Switch
          checked={!settings.disableDuet}
          onCheckedChange={(checked) => onChange({ disableDuet: !checked })}
        />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <Label>Allow Stitch</Label>
          <p className="text-muted-foreground text-xs">
            Let others create Stitches with this video
          </p>
        </div>
        <Switch
          checked={!settings.disableStitch}
          onCheckedChange={(checked) => onChange({ disableStitch: !checked })}
        />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <Label>Allow Comments</Label>
          <p className="text-muted-foreground text-xs">
            Let viewers comment on this video
          </p>
        </div>
        <Switch
          checked={!settings.disableComment}
          onCheckedChange={(checked) => onChange({ disableComment: !checked })}
        />
      </div>
    </div>
  );
}

function InstagramSettings({ settings, onChange }: SettingsProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Label>Share to Feed</Label>
          <p className="text-muted-foreground text-xs">
            Also show on your profile grid
          </p>
        </div>
        <Switch
          checked={settings.shareToFeed ?? true}
          onCheckedChange={(checked) => onChange({ shareToFeed: checked })}
        />
      </div>
    </div>
  );
}

function FacebookSettings({ settings, onChange }: SettingsProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Label>Post as Reel</Label>
          <p className="text-muted-foreground text-xs">
            Short-form vertical video format
          </p>
        </div>
        <Switch
          checked={settings.isReel ?? false}
          onCheckedChange={(checked) => onChange({ isReel: checked })}
        />
      </div>
    </div>
  );
}
