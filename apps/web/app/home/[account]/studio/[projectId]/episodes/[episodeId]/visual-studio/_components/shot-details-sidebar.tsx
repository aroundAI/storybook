'use client';

import { useState, useTransition } from 'react';

import { Copy, ExternalLink, RefreshCw, X } from 'lucide-react';

import { updateShotAction } from '@kit/episodes/server';
import type { Shot } from '@kit/episodes/types';
import { Button } from '@kit/ui/button';
import { Input } from '@kit/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { toast } from '@kit/ui/sonner';
import { Textarea } from '@kit/ui/textarea';
import { cn } from '@kit/ui/utils';

interface ShotDetailsSidebarProps {
  shot: Shot;
  onClose: () => void;
  onUpdate: () => void;
}

const MOVEMENTS = [
  { value: 'static', label: 'Static' },
  { value: 'pan', label: 'Pan' },
  { value: 'tilt', label: 'Tilt' },
  { value: 'dolly', label: 'Dolly' },
  { value: 'tracking', label: 'Tracking' },
  { value: 'crane', label: 'Crane' },
  { value: 'handheld', label: 'Handheld' },
] as const;

const ANGLES = [
  { value: 'wide', label: 'Wide' },
  { value: 'medium', label: 'Medium' },
  { value: 'close-up', label: 'Close-up' },
  { value: 'extreme-close-up', label: 'Extreme Close-up' },
  { value: 'over-shoulder', label: 'Over Shoulder' },
  { value: 'pov', label: 'POV' },
] as const;

const LIGHTING = [
  { value: 'soft-day', label: 'Soft Day' },
  { value: 'golden-hour', label: 'Golden Hour' },
  { value: 'night', label: 'Night' },
  { value: 'studio', label: 'Studio' },
  { value: 'dramatic', label: 'Dramatic' },
  { value: 'natural', label: 'Natural' },
] as const;

const STYLES = [
  { value: 'watercolor', label: 'Watercolor' },
  { value: 'cinematic', label: 'Cinematic' },
  { value: 'anime', label: 'Anime' },
  { value: 'realistic', label: 'Realistic' },
  { value: 'cartoon', label: 'Cartoon' },
  { value: 'painterly', label: 'Painterly' },
] as const;

export function ShotDetailsSidebar({
  shot,
  onClose,
  onUpdate,
}: ShotDetailsSidebarProps) {
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<'prompt' | 'enhance'>('prompt');

  // Form state
  const [editedPrompt, setEditedPrompt] = useState(shot.prompt ?? '');
  const [movement, setMovement] = useState(shot.cameraMovement ?? 'static');
  const [angle, setAngle] = useState(shot.cameraAngle ?? 'medium');
  const [lighting, setLighting] = useState('soft-day');
  const [style, setStyle] = useState('watercolor');
  const [negativePrompt, setNegativePrompt] = useState(
    'blurry, low quality, distorted hands, bad anatomy',
  );
  const [seed, setSeed] = useState(
    Math.floor(Math.random() * 1000000000).toString(),
  );

  const handleCopySeed = () => {
    navigator.clipboard.writeText(seed);
    toast.success('Seed copied to clipboard');
  };

  const handleRegenerate = () => {
    startTransition(async () => {
      try {
        const result = await updateShotAction({
          shotId: shot.id,
          prompt: editedPrompt,
        });

        if (result.success) {
          toast.info('Shot queued for regeneration');
          onUpdate();
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Failed to regenerate shot',
        );
      }
    });
  };

  const handleEnhanceWithAI = () => {
    toast.info('AI enhancement coming soon');
    // TODO: Integrate with AI prompt enhancement
  };

  return (
    <div className="flex h-full w-96 flex-col rounded-l-3xl border-l border-gray-200 bg-white/70 shadow-xl backdrop-blur-xl dark:border-gray-700/30 dark:bg-gray-800/70">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200/50 p-4 dark:border-gray-700/50">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Shot {shot.sceneNumber}.{shot.shotNumber} Details
        </h3>
        <div className="flex items-center gap-1">
          <button className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300">
            <ExternalLink className="h-5 w-5" />
          </button>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Info Bar */}
      <div className="flex items-center gap-3 border-b border-gray-200/50 px-4 py-3 dark:border-gray-700/50">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {shot.duration}s Duration
        </span>
        <span className="text-gray-300 dark:text-gray-600">•</span>
        <span className="text-sm text-gray-500 dark:text-gray-400">16:9</span>
        <span className="text-gray-300 dark:text-gray-600">•</span>
        <span className="text-sm text-gray-500 capitalize dark:text-gray-400">
          {movement}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Visual Prompt Section */}
        <div className="border-b border-gray-200/50 p-4 dark:border-gray-700/50">
          {/* Tab Headers */}
          <div className="mb-3 flex items-center gap-4">
            <button
              className={cn(
                'text-xs font-semibold uppercase tracking-wide transition-colors',
                activeTab === 'prompt'
                  ? 'text-gray-900 dark:text-white'
                  : 'text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300',
              )}
              onClick={() => setActiveTab('prompt')}
            >
              Visual Prompt
            </button>
            <button
              className={cn(
                'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                activeTab === 'enhance'
                  ? 'bg-blue-600 text-white'
                  : 'bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50',
              )}
              onClick={() => {
                setActiveTab('enhance');
                handleEnhanceWithAI();
              }}
            >
              ENHANCE WITH AI
            </button>
          </div>

          <Textarea
            value={editedPrompt}
            onChange={(e) => setEditedPrompt(e.target.value)}
            rows={5}
            className="resize-none bg-white/50 text-sm dark:bg-gray-800/50"
            placeholder="Describe the visual for this shot..."
          />
        </div>

        {/* Settings Grid */}
        <div className="grid grid-cols-2 gap-4 border-b border-gray-200/50 p-4 dark:border-gray-700/50">
          {/* Movement */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Movement
            </label>
            <Select value={movement} onValueChange={(v) => setMovement(v as typeof movement)}>
              <SelectTrigger className="bg-white/50 dark:bg-gray-800/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MOVEMENTS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Angle */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Angle
            </label>
            <Select value={angle} onValueChange={(v) => setAngle(v as typeof angle)}>
              <SelectTrigger className="bg-white/50 dark:bg-gray-800/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ANGLES.map((a) => (
                  <SelectItem key={a.value} value={a.value}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Lighting */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Lighting
            </label>
            <Select value={lighting} onValueChange={setLighting}>
              <SelectTrigger className="bg-white/50 dark:bg-gray-800/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LIGHTING.map((l) => (
                  <SelectItem key={l.value} value={l.value}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Style */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Style
            </label>
            <Select value={style} onValueChange={setStyle}>
              <SelectTrigger className="bg-white/50 dark:bg-gray-800/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STYLES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Negative Prompt */}
        <div className="border-b border-gray-200/50 p-4 dark:border-gray-700/50">
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Negative Prompt
          </label>
          <Input
            value={negativePrompt}
            onChange={(e) => setNegativePrompt(e.target.value)}
            placeholder="blurry, low quality, distorted hands..."
            className="bg-white/50 text-sm dark:bg-gray-800/50"
          />
        </div>

        {/* Seed */}
        <div className="p-4">
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Seed
          </label>
          <div className="flex gap-2">
            <Input
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder="Random"
              className="flex-1 bg-white/50 font-mono text-sm dark:bg-gray-800/50"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={handleCopySeed}
              className="shrink-0 bg-white/50 dark:bg-gray-800/50"
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-gray-200/50 p-4 dark:border-gray-700/50">
        <Button
          variant="outline"
          onClick={handleRegenerate}
          disabled={isPending}
          className="w-full gap-2 bg-white/50 dark:bg-gray-800/50"
        >
          <RefreshCw className={cn('h-4 w-4', isPending && 'animate-spin')} />
          {isPending ? 'Regenerating...' : 'Regenerate Shot'}
        </Button>
      </div>
    </div>
  );
}
