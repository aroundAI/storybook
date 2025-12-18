'use client';

import { useState } from 'react';

import { Button } from '@kit/ui/button';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { Textarea } from '@kit/ui/textarea';
import { cn } from '@kit/ui/utils';

import type { CameraAngle, CameraMovement, Shot } from '../../lib/types';
import { MaterialIcon } from '../ui';

interface ShotDetailsPanelProps {
  shot: Shot | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdate?: (shotId: string, updates: Partial<Shot>) => void;
  onRegenerate?: (shotId: string) => void;
}

/**
 * ShotDetailsPanel - Slide-out panel for editing shot details
 */
export function ShotDetailsPanel({
  shot,
  isOpen,
  onClose,
  onUpdate,
  onRegenerate,
}: ShotDetailsPanelProps) {
  const [prompt, setPrompt] = useState(shot?.prompt || '');
  const [cameraMovement, setCameraMovement] = useState<CameraMovement | null>(
    shot?.cameraMovement || null,
  );
  const [cameraAngle, setCameraAngle] = useState<CameraAngle | null>(
    shot?.cameraAngle || null,
  );
  const [seed, setSeed] = useState(
    shot?.generationSettings?.seed?.toString() || '',
  );
  const [negativePrompt, setNegativePrompt] = useState(
    shot?.generationSettings?.negativePrompt || '',
  );

  if (!shot) return null;

  const handleSave = () => {
    if (!onUpdate) return;

    onUpdate(shot.id, {
      prompt,
      cameraMovement,
      cameraAngle,
      generationSettings: {
        ...shot.generationSettings,
        seed: seed ? parseInt(seed, 10) : undefined,
        negativePrompt,
      },
    });
  };

  const handleCopySeed = async () => {
    if (seed) {
      await navigator.clipboard.writeText(seed);
    }
  };

  const aspectRatio = shot.generationSettings?.aspectRatio || '16:9';
  const duration = shot.duration;

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        className={cn(
          'fixed right-0 top-0 z-50 flex h-full w-96 flex-col border-l border-gray-200 bg-white/70 p-6 shadow-xl backdrop-blur-xl transition-transform duration-300',
          'liquid-sidebar rounded-l-3xl',
          isOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-debossed text-xl font-semibold text-gray-800">
            Shot {shot.sceneNumber}.{shot.shotNumber} Details
          </h2>
          <div className="flex items-center space-x-2">
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700"
            >
              <MaterialIcon name="close" size="md" />
            </button>
          </div>
        </div>

        {/* Shot info */}
        <div className="mb-6 flex items-center space-x-4 text-sm text-gray-500">
          <span className="liquid-pill text-debossed font-semibold text-blue-600">
            {duration}s Duration
          </span>
          <span className="text-debossed">• {aspectRatio}</span>
          <span className="text-debossed">• {cameraMovement || 'static'}</span>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 space-y-6 overflow-y-auto pr-2">
          {/* Visual Prompt */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label className="text-debossed text-sm font-semibold text-gray-700">
                VISUAL PROMPT
              </Label>
              <Button
                size="sm"
                variant="ghost"
                className="liquid-button h-auto bg-blue-100/50 px-3 py-1 text-sm font-medium text-blue-600"
              >
                ENHANCE WITH AI
              </Button>
            </div>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="text-debossed liquid-card min-h-[120px] resize-none p-4 text-sm leading-relaxed text-gray-800"
              placeholder="Describe the visual elements of this shot..."
            />
          </div>

          {/* Movement & Angle */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-debossed mb-2 block text-sm font-semibold text-gray-700">
                MOVEMENT
              </Label>
              <Select
                value={cameraMovement || 'static'}
                onValueChange={(value) =>
                  setCameraMovement(value as CameraMovement)
                }
              >
                <SelectTrigger className="liquid-dropdown text-debossed">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="static">Static</SelectItem>
                  <SelectItem value="pan">Pan</SelectItem>
                  <SelectItem value="tilt">Tilt</SelectItem>
                  <SelectItem value="zoom">Zoom</SelectItem>
                  <SelectItem value="dolly">Dolly</SelectItem>
                  <SelectItem value="tracking">Tracking</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-debossed mb-2 block text-sm font-semibold text-gray-700">
                ANGLE
              </Label>
              <Select
                value={cameraAngle || 'medium'}
                onValueChange={(value) => setCameraAngle(value as CameraAngle)}
              >
                <SelectTrigger className="liquid-dropdown text-debossed">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="close-up">Close-up</SelectItem>
                  <SelectItem value="medium">Medium Shot</SelectItem>
                  <SelectItem value="wide">Wide Shot</SelectItem>
                  <SelectItem value="extreme-close-up">
                    Extreme Close-up
                  </SelectItem>
                  <SelectItem value="over-the-shoulder">
                    Over-the-shoulder
                  </SelectItem>
                  <SelectItem value="pov">POV</SelectItem>
                  <SelectItem value="low-angle">Low Angle</SelectItem>
                  <SelectItem value="high-angle">High Angle</SelectItem>
                  <SelectItem value="birds-eye">Bird&apos;s Eye</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Lighting & Style */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-debossed mb-2 block text-sm font-semibold text-gray-700">
                LIGHTING
              </Label>
              <Select defaultValue="soft-day">
                <SelectTrigger className="liquid-dropdown text-debossed">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="soft-day">Soft Day</SelectItem>
                  <SelectItem value="golden-hour">Golden Hour</SelectItem>
                  <SelectItem value="night">Night</SelectItem>
                  <SelectItem value="dramatic">Dramatic</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-debossed mb-2 block text-sm font-semibold text-gray-700">
                STYLE
              </Label>
              <Select defaultValue="watercolor">
                <SelectTrigger className="liquid-dropdown text-debossed">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="watercolor">Watercolor</SelectItem>
                  <SelectItem value="anime">Anime</SelectItem>
                  <SelectItem value="photorealistic">Photorealistic</SelectItem>
                  <SelectItem value="oil-painting">Oil Painting</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Negative Prompt */}
          <div>
            <Label className="text-debossed mb-2 block text-sm font-semibold text-gray-700">
              NEGATIVE PROMPT
            </Label>
            <Input
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              className="liquid-input text-debossed"
              placeholder="blurry, low quality, distorted hands..."
            />
          </div>

          {/* Seed */}
          <div>
            <Label className="text-debossed mb-2 block text-sm font-semibold text-gray-700">
              SEED
            </Label>
            <div className="relative flex items-center">
              <Input
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                className="liquid-input text-debossed pr-10"
                placeholder="Random seed..."
              />
              <button
                onClick={handleCopySeed}
                className="liquid-dropdown-arrow absolute right-3 cursor-pointer"
              >
                <MaterialIcon name="content_copy" size="sm" />
              </button>
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="mt-auto space-y-3 border-t border-gray-200 pt-6">
          <Button onClick={handleSave} className="w-full" variant="default">
            Save Changes
          </Button>
          <Button
            onClick={() => onRegenerate?.(shot.id)}
            className="liquid-button flex w-full items-center justify-center space-x-2 rounded-full bg-blue-500 py-3 font-semibold text-white"
          >
            <MaterialIcon name="refresh" size="md" />
            <span className="text-debossed">Regenerate Shot</span>
          </Button>
        </div>
      </div>
    </>
  );
}
