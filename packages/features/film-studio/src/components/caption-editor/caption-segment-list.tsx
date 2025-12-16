'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, X } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Input } from '@kit/ui/input';
import { ScrollArea } from '@kit/ui/scroll-area';
import { toast } from '@kit/ui/sonner';
import { cn } from '@kit/ui/utils';

import { formatDisplayTime } from '../../lib/caption-utils';
import { updateCaptionSegmentAction } from '../../server/caption-actions';

interface Segment {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  speakerId?: string | null;
  sequenceNumber: number;
  isEdited?: boolean;
}

interface CaptionSegmentListProps {
  segments: Segment[];
  currentTime: number;
  onSegmentClick?: (startTime: number) => void;
}

export function CaptionSegmentList({
  segments,
  currentTime,
  onSegmentClick,
}: CaptionSegmentListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const activeSegmentRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: updateCaptionSegmentAction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['captions'] });
      toast.success('Caption updated');
      setEditingId(null);
      setEditText('');
    },
    onError: () => {
      toast.error('Failed to update caption');
    },
  });

  const handleEdit = useCallback((segment: Segment) => {
    setEditingId(segment.id);
    setEditText(segment.text);
  }, []);

  const handleSave = useCallback(
    (segmentId: string) => {
      if (!editText.trim()) {
        toast.error('Caption text cannot be empty');
        return;
      }
      updateMutation.mutate({
        segmentId,
        text: editText.trim(),
      });
    },
    [updateMutation, editText],
  );

  const handleCancel = useCallback(() => {
    setEditingId(null);
    setEditText('');
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, segmentId: string) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSave(segmentId);
      } else if (e.key === 'Escape') {
        handleCancel();
      }
    },
    [handleSave, handleCancel],
  );

  // Auto-scroll to active segment
  useEffect(() => {
    if (activeSegmentRef.current && !editingId) {
      activeSegmentRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [currentTime, editingId]);

  const sortedSegments = [...segments].sort(
    (a, b) => a.sequenceNumber - b.sequenceNumber,
  );

  return (
    <ScrollArea className="h-[400px] rounded-md border">
      <div className="space-y-1 p-2">
        {sortedSegments.map((segment) => {
          const isActive =
            currentTime >= segment.startTime && currentTime < segment.endTime;
          const isEditing = editingId === segment.id;

          return (
            <div
              key={segment.id}
              ref={isActive ? activeSegmentRef : null}
              className={cn(
                'group relative flex items-start gap-3 rounded-lg border p-3 transition-all',
                isActive
                  ? 'border-primary bg-primary/5 shadow-sm'
                  : 'hover:bg-muted/50 border-transparent',
                !isEditing && 'cursor-pointer',
              )}
              onClick={() => !isEditing && onSegmentClick?.(segment.startTime)}
            >
              {/* Timestamp */}
              <div className="w-20 shrink-0 pt-0.5">
                <span className="text-muted-foreground font-mono text-xs">
                  {formatDisplayTime(segment.startTime)}
                </span>
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1">
                {isEditing ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => handleKeyDown(e, segment.id)}
                      className="flex-1"
                      autoFocus
                      disabled={updateMutation.isPending}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSave(segment.id);
                      }}
                      disabled={updateMutation.isPending}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCancel();
                      }}
                      disabled={updateMutation.isPending}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <p
                      className={cn(
                        'text-sm leading-relaxed',
                        segment.isEdited && 'italic',
                      )}
                    >
                      {segment.text}
                    </p>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEdit(segment);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>

              {/* Active indicator */}
              {isActive && (
                <div className="bg-primary absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full" />
              )}
            </div>
          );
        })}

        {sortedSegments.length === 0 && (
          <div className="text-muted-foreground py-8 text-center">
            No caption segments
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
