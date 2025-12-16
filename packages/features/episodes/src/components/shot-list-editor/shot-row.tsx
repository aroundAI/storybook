'use client';

import { useState, useTransition } from 'react';

import Image from 'next/image';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, Film, GripVertical, Loader2, Play, X } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Checkbox } from '@kit/ui/checkbox';
import { toast } from '@kit/ui/sonner';
import { TableCell } from '@kit/ui/table';
import { Textarea } from '@kit/ui/textarea';
import { cn } from '@kit/ui/utils';

import { updateShotAction } from '../../lib/server/mutations/shot-actions';
import type { Shot, ShotStatus } from '../../lib/types';

interface ShotRowProps {
  shot: Shot;
  isSelected: boolean;
  onSelect: (selected: boolean) => void;
  onUpdate: () => void;
}

const STATUS_VARIANTS: Record<ShotStatus, string> = {
  pending: 'bg-muted text-muted-foreground',
  generating: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  completed:
    'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

export function ShotRow({
  shot,
  isSelected,
  onSelect,
  onUpdate,
}: ShotRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState(shot.prompt ?? '');
  const [isPending, startTransition] = useTransition();

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: shot.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleSave = () => {
    startTransition(async () => {
      try {
        await updateShotAction({
          shotId: shot.id,
          prompt: editedPrompt,
        });
        setIsEditing(false);
        onUpdate();
        toast.success('Shot updated');
      } catch {
        toast.error('Failed to update shot');
      }
    });
  };

  const handleCancel = () => {
    setEditedPrompt(shot.prompt ?? '');
    setIsEditing(false);
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={cn(
        'border-b transition-colors',
        // Hover state
        'hover:bg-muted/50',
        // Dragging state
        isDragging && 'opacity-50',
        // Selected state
        isSelected && 'bg-muted',
        // Status variants
        shot.status === 'completed' &&
          'bg-muted/10 opacity-60 hover:opacity-100',
        shot.status === 'failed' && 'bg-destructive/10',
        shot.status === 'generating' && 'bg-blue-50/50 dark:bg-blue-900/10',
      )}
    >
      <TableCell className="w-10">
        <Checkbox
          checked={isSelected}
          onCheckedChange={onSelect}
          aria-label="Select shot"
        />
      </TableCell>
      <TableCell className="w-10 cursor-grab" {...attributes} {...listeners}>
        <GripVertical className="text-muted-foreground h-4 w-4" />
      </TableCell>
      <TableCell className="w-16 font-mono text-sm">
        {shot.sceneNumber}.{shot.shotNumber}
      </TableCell>
      <TableCell className="w-24">
        <Badge className={cn('text-xs', STATUS_VARIANTS[shot.status])}>
          {shot.status}
        </Badge>
      </TableCell>
      <TableCell className="w-20 text-sm">{shot.duration}s</TableCell>
      <TableCell className="min-w-[200px]">
        {isEditing ? (
          <div className="flex items-center gap-2">
            <Textarea
              value={editedPrompt}
              onChange={(e) => setEditedPrompt(e.target.value)}
              className="min-h-[60px] text-sm"
              placeholder="Shot prompt..."
            />
            <div className="flex flex-col gap-1">
              <Button
                size="icon"
                variant="ghost"
                onClick={handleSave}
                disabled={isPending}
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={handleCancel}
                disabled={isPending}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          <div
            className="hover:bg-accent -m-1 cursor-pointer rounded p-1 text-sm"
            onClick={() => setIsEditing(true)}
          >
            {shot.prompt || shot.description || (
              <span className="text-muted-foreground italic">
                Click to add prompt
              </span>
            )}
          </div>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground w-24 text-xs">
        {shot.cameraAngle ?? '-'}
      </TableCell>
      <TableCell className="text-muted-foreground w-24 text-xs">
        {shot.cameraMovement ?? '-'}
      </TableCell>
      <TableCell className="w-24">
        {shot.thumbnailUrl ? (
          <div className="relative h-12 w-20 overflow-hidden rounded">
            <Image
              src={shot.thumbnailUrl}
              alt={`Shot ${shot.sceneNumber}.${shot.shotNumber}`}
              fill
              className="object-cover"
            />
            {shot.videoUrl && (
              <Button
                size="icon"
                variant="secondary"
                className="absolute inset-0 m-auto h-6 w-6 opacity-80"
              >
                <Play className="h-3 w-3" />
              </Button>
            )}
          </div>
        ) : (
          <div className="bg-muted/50 flex h-12 w-20 items-center justify-center rounded">
            <Film className="text-muted-foreground/30 h-4 w-4" />
          </div>
        )}
      </TableCell>
    </tr>
  );
}
