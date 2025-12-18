'use client';

import { useState, useTransition } from 'react';

import { Camera, Clock, Loader2, RefreshCw, Trash2, X } from 'lucide-react';

import { deleteShotAction, updateShotAction } from '@kit/episodes/server';
import type { Shot } from '@kit/episodes/types';
import { Button } from '@kit/ui/button';
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

const _CAMERA_ANGLES = [
  'wide',
  'medium',
  'close-up',
  'extreme-close-up',
  'over-shoulder',
  'pov',
] as const;

const _CAMERA_MOVEMENTS = [
  'static',
  'pan',
  'tilt',
  'dolly',
  'tracking',
  'crane',
  'handheld',
] as const;

export function ShotDetailsSidebar({
  shot,
  onClose,
  onUpdate,
}: ShotDetailsSidebarProps) {
  const [isPending, startTransition] = useTransition();
  const [editedPrompt, setEditedPrompt] = useState(shot.prompt ?? '');
  const [editedDescription, setEditedDescription] = useState(shot.description);
  const [editedDuration, setEditedDuration] = useState(shot.duration);

  const hasChanges =
    editedPrompt !== (shot.prompt ?? '') ||
    editedDescription !== shot.description ||
    editedDuration !== shot.duration;

  const handleSave = () => {
    startTransition(async () => {
      try {
        const result = await updateShotAction({
          shotId: shot.id,
          prompt: editedPrompt,
          description: editedDescription,
          durationSeconds: editedDuration,
        });

        if (result.success) {
          toast.success('Shot updated');
          onUpdate();
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Failed to update shot',
        );
      }
    });
  };

  const handleDelete = () => {
    if (!confirm('Are you sure you want to delete this shot?')) return;

    startTransition(async () => {
      try {
        const result = await deleteShotAction({ shotId: shot.id });
        if (result.success) {
          toast.success('Shot deleted');
          onUpdate();
          onClose();
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Failed to delete shot',
        );
      }
    });
  };

  const handleRegenerate = () => {
    toast.info('Video regeneration queued');
    // TODO: Integrate with video generation action
  };

  return (
    <div className="flex h-full w-96 flex-col border-l border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <h3 className="font-semibold text-gray-900 dark:text-white">
          Shot #{shot.shotNumber}
        </h3>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Preview */}
        <div className="aspect-video bg-gray-100 dark:bg-gray-700">
          {shot.videoUrl ? (
            <video
              src={shot.videoUrl}
              controls
              className="h-full w-full object-cover"
            />
          ) : shot.thumbnailUrl ? (
            <img
              src={shot.thumbnailUrl}
              alt={`Shot ${shot.shotNumber}`}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <Camera className="h-12 w-12 text-gray-300 dark:text-gray-600" />
            </div>
          )}
        </div>

        {/* Status */}
        <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Status
            </span>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                shot.status === 'pending' &&
                  'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
                shot.status === 'generating' &&
                  'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
                shot.status === 'completed' &&
                  'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
                shot.status === 'failed' &&
                  'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
              )}
            >
              {shot.status}
            </span>
          </div>
        </div>

        {/* Details Form */}
        <div className="space-y-4 p-4">
          {/* Duration */}
          <div>
            <label className="mb-1.5 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              <Clock className="h-4 w-4" />
              Duration (seconds)
            </label>
            <Select
              value={editedDuration.toString()}
              onValueChange={(v) => setEditedDuration(parseInt(v))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[3, 4, 5, 6, 7, 8, 9, 10].map((d) => (
                  <SelectItem key={d} value={d.toString()}>
                    {d} seconds
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Camera Info (Read-only for now) */}
          {(shot.cameraAngle ||
            shot.cameraMovement ||
            shot.cameraDirection) && (
            <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-700/50">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                <Camera className="h-3.5 w-3.5" />
                Camera
              </div>
              <div className="space-y-1 text-sm text-gray-700 dark:text-gray-300">
                {shot.cameraDirection && (
                  <div>Direction: {shot.cameraDirection}</div>
                )}
              </div>
            </div>
          )}

          {/* Description */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Description
            </label>
            <Textarea
              value={editedDescription}
              onChange={(e) => setEditedDescription(e.target.value)}
              rows={3}
              className="resize-none"
            />
          </div>

          {/* Visual Prompt */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Visual Prompt
            </label>
            <Textarea
              value={editedPrompt}
              onChange={(e) => setEditedPrompt(e.target.value)}
              rows={5}
              placeholder="Describe the visual for AI video generation..."
              className="resize-none font-mono text-xs"
            />
          </div>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="border-t border-gray-200 p-4 dark:border-gray-700">
        <div className="mb-3 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRegenerate}
            disabled={isPending || shot.status === 'generating'}
            className="flex-1"
          >
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Regenerate
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDelete}
            disabled={isPending}
            className="text-red-600 hover:bg-red-50 hover:text-red-700"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        <Button
          onClick={handleSave}
          disabled={isPending || !hasChanges}
          className="w-full gap-2 bg-blue-600 text-white hover:bg-blue-700"
        >
          {isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            'Save Changes'
          )}
        </Button>
      </div>
    </div>
  );
}
