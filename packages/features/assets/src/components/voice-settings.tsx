'use client';

import { Label } from '@kit/ui/label';
import { Slider } from '@kit/ui/slider';
import { Switch } from '@kit/ui/switch';

export interface VoiceSettingsData {
  stability: number;
  similarityBoost: number;
  style?: number;
  useSpeakerBoost?: boolean;
}

interface VoiceSettingsProps {
  settings: VoiceSettingsData;
  onChange: (settings: VoiceSettingsData) => void;
}

export function VoiceSettings({ settings, onChange }: VoiceSettingsProps) {
  return (
    <div className="space-y-6">
      <h3 className="font-semibold">Voice Settings</h3>

      {/* Stability */}
      <div className="space-y-2">
        <div className="flex justify-between">
          <Label>Stability</Label>
          <span className="text-muted-foreground text-sm">
            {Math.round(settings.stability * 100)}%
          </span>
        </div>
        <Slider
          value={[settings.stability]}
          onValueChange={([value]) =>
            onChange({ ...settings, stability: value ?? 0.5 })
          }
          min={0}
          max={1}
          step={0.01}
        />
        <p className="text-muted-foreground text-xs">
          Higher values make the voice more consistent but less expressive
        </p>
      </div>

      {/* Similarity Boost */}
      <div className="space-y-2">
        <div className="flex justify-between">
          <Label>Similarity Boost</Label>
          <span className="text-muted-foreground text-sm">
            {Math.round(settings.similarityBoost * 100)}%
          </span>
        </div>
        <Slider
          value={[settings.similarityBoost]}
          onValueChange={([value]) =>
            onChange({ ...settings, similarityBoost: value ?? 0.75 })
          }
          min={0}
          max={1}
          step={0.01}
        />
        <p className="text-muted-foreground text-xs">
          Higher values make the voice closer to the original
        </p>
      </div>

      {/* Style (optional) */}
      {settings.style !== undefined && (
        <div className="space-y-2">
          <div className="flex justify-between">
            <Label>Style Exaggeration</Label>
            <span className="text-muted-foreground text-sm">
              {Math.round((settings.style ?? 0) * 100)}%
            </span>
          </div>
          <Slider
            value={[settings.style ?? 0]}
            onValueChange={([value]) =>
              onChange({ ...settings, style: value ?? 0 })
            }
            min={0}
            max={1}
            step={0.01}
          />
          <p className="text-muted-foreground text-xs">
            Amplifies the style of the voice (requires ElevenLabs Pro)
          </p>
        </div>
      )}

      {/* Speaker Boost */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label>Speaker Boost</Label>
          <p className="text-muted-foreground text-xs">
            Enhance voice clarity and quality
          </p>
        </div>
        <Switch
          checked={settings.useSpeakerBoost ?? true}
          onCheckedChange={(checked) =>
            onChange({ ...settings, useSpeakerBoost: checked })
          }
        />
      </div>
    </div>
  );
}
