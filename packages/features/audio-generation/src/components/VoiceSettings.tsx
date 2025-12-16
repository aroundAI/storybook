'use client';

import { RefreshCw } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Label } from '@kit/ui/label';
import { Slider } from '@kit/ui/slider';

import { DEFAULT_VOICE_SETTINGS } from '../lib/constants';
import type { VoiceSettings as VoiceSettingsType } from '../lib/types';

export interface VoiceSettingsPanelProps {
  settings: VoiceSettingsType;
  onSettingsChange: (settings: VoiceSettingsType) => void;
  onReset?: () => void;
  disabled?: boolean;
}

const SETTING_DESCRIPTIONS = {
  stability: 'Higher = more consistent, Lower = more variable and expressive',
  similarityBoost: 'Higher = closer to original voice characteristics',
  style: 'Controls exaggeration of speaking style (0 = neutral)',
  speed: 'Playback speed multiplier (1.0 = normal)',
};

export function VoiceSettingsPanel({
  settings,
  onSettingsChange,
  onReset,
  disabled = false,
}: VoiceSettingsPanelProps) {
  const handleStabilityChange = (value: number[]) => {
    onSettingsChange({ ...settings, stability: value[0] });
  };

  const handleSimilarityBoostChange = (value: number[]) => {
    onSettingsChange({ ...settings, similarityBoost: value[0] });
  };

  const handleStyleChange = (value: number[]) => {
    onSettingsChange({ ...settings, style: value[0] });
  };

  const handleSpeedChange = (value: number[]) => {
    onSettingsChange({ ...settings, speed: value[0] });
  };

  const handleReset = () => {
    onSettingsChange({ ...DEFAULT_VOICE_SETTINGS });
    onReset?.();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Label className="text-base font-medium">Voice Settings</Label>
        <Button
          variant="outline"
          size="sm"
          onClick={handleReset}
          disabled={disabled}
          data-test="reset-voice-settings"
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Reset to Defaults
        </Button>
      </div>

      {/* Stability */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm" htmlFor="stability-slider">
            Stability
          </Label>
          <span className="text-muted-foreground text-sm">
            {(settings.stability ?? DEFAULT_VOICE_SETTINGS.stability).toFixed(
              2,
            )}
          </span>
        </div>
        <Slider
          id="stability-slider"
          value={[settings.stability ?? DEFAULT_VOICE_SETTINGS.stability]}
          onValueChange={handleStabilityChange}
          min={0}
          max={1}
          step={0.01}
          disabled={disabled}
          aria-label="Voice stability"
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={settings.stability ?? DEFAULT_VOICE_SETTINGS.stability}
          data-test="stability-slider"
        />
        <p className="text-muted-foreground text-xs">
          {SETTING_DESCRIPTIONS.stability}
        </p>
      </div>

      {/* Similarity Boost */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm" htmlFor="similarity-slider">
            Similarity Boost
          </Label>
          <span className="text-muted-foreground text-sm">
            {(
              settings.similarityBoost ?? DEFAULT_VOICE_SETTINGS.similarityBoost
            ).toFixed(2)}
          </span>
        </div>
        <Slider
          id="similarity-slider"
          value={[
            settings.similarityBoost ?? DEFAULT_VOICE_SETTINGS.similarityBoost,
          ]}
          onValueChange={handleSimilarityBoostChange}
          min={0}
          max={1}
          step={0.01}
          disabled={disabled}
          aria-label="Voice similarity boost"
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={
            settings.similarityBoost ?? DEFAULT_VOICE_SETTINGS.similarityBoost
          }
          data-test="similarity-slider"
        />
        <p className="text-muted-foreground text-xs">
          {SETTING_DESCRIPTIONS.similarityBoost}
        </p>
      </div>

      {/* Style */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm" htmlFor="style-slider">
            Style
          </Label>
          <span className="text-muted-foreground text-sm">
            {(settings.style ?? DEFAULT_VOICE_SETTINGS.style).toFixed(2)}
          </span>
        </div>
        <Slider
          id="style-slider"
          value={[settings.style ?? DEFAULT_VOICE_SETTINGS.style]}
          onValueChange={handleStyleChange}
          min={0}
          max={1}
          step={0.01}
          disabled={disabled}
          aria-label="Voice style"
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={settings.style ?? DEFAULT_VOICE_SETTINGS.style}
          data-test="style-slider"
        />
        <p className="text-muted-foreground text-xs">
          {SETTING_DESCRIPTIONS.style}
        </p>
      </div>

      {/* Speed */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm" htmlFor="speed-slider">
            Speed
          </Label>
          <span className="text-muted-foreground text-sm">
            {(settings.speed ?? DEFAULT_VOICE_SETTINGS.speed).toFixed(2)}x
          </span>
        </div>
        <Slider
          id="speed-slider"
          value={[settings.speed ?? DEFAULT_VOICE_SETTINGS.speed]}
          onValueChange={handleSpeedChange}
          min={0.5}
          max={2.0}
          step={0.1}
          disabled={disabled}
          aria-label="Voice speed"
          aria-valuemin={0.5}
          aria-valuemax={2.0}
          aria-valuenow={settings.speed ?? DEFAULT_VOICE_SETTINGS.speed}
          data-test="speed-slider"
        />
        <p className="text-muted-foreground text-xs">
          {SETTING_DESCRIPTIONS.speed}
        </p>
      </div>
    </div>
  );
}
