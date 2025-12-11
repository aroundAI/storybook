'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useMutation } from '@tanstack/react-query';
import {
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  Download,
  Pause,
  Play,
  RefreshCw,
  Scissors,
  Trash2,
} from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import { Slider } from '@kit/ui/slider';
import { toast } from '@kit/ui/sonner';

import { formatTime } from '../lib/format-time';
import type {
  ClipRegion,
  CropSettings,
  GeneratedClip,
  ShortsClipperProps,
} from '../lib/types';
import { generateClipAction } from '../server/clip-actions';

const DEFAULT_CROP_SETTINGS: CropSettings = {
  type: 'center',
  x: 0.5,
  y: 0.5,
  scale: 1,
};

export function ShortsClipper({
  videoUrl,
  duration,
  episodeId,
  onClipCreated,
}: ShortsClipperProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [clips, setClips] = useState<ClipRegion[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [generatingClipId, setGeneratingClipId] = useState<string | null>(null);

  const selectedClip = useMemo(
    () => clips.find((c) => c.id === selectedClipId),
    [clips, selectedClipId],
  );

  // Video controls
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
    } else {
      video.play();
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying]);

  const seekTo = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;

    video.currentTime = time;
    setCurrentTime(time);
  }, []);

  // Update current time as video plays
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => setCurrentTime(video.currentTime);
    const handleEnded = () => setIsPlaying(false);

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('ended', handleEnded);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('ended', handleEnded);
    };
  }, []);

  // Add new clip at current position
  const addClip = useCallback(() => {
    const newClip: ClipRegion = {
      id: crypto.randomUUID(),
      startTime: Math.max(0, currentTime - 15),
      endTime: Math.min(duration, currentTime + 15),
      title: `Clip ${clips.length + 1}`,
      cropSettings: { ...DEFAULT_CROP_SETTINGS },
    };
    setClips([...clips, newClip]);
    setSelectedClipId(newClip.id);
  }, [clips, currentTime, duration]);

  // Update clip
  const updateClip = useCallback(
    (clipId: string, updates: Partial<ClipRegion>) => {
      setClips(clips.map((c) => (c.id === clipId ? { ...c, ...updates } : c)));
    },
    [clips],
  );

  // Delete clip
  const deleteClip = useCallback(
    (clipId: string) => {
      setClips(clips.filter((c) => c.id !== clipId));
      if (selectedClipId === clipId) {
        setSelectedClipId(null);
      }
    },
    [clips, selectedClipId],
  );

  // Generate clip mutation
  const generateMutation = useMutation({
    mutationFn: async (clip: ClipRegion) => {
      setGeneratingClipId(clip.id);
      return generateClipAction({
        episodeId,
        videoUrl,
        startTime: clip.startTime,
        endTime: clip.endTime,
        title: clip.title,
        cropSettings: clip.cropSettings,
        aspectRatio: '9:16',
      });
    },
    onSuccess: (result: GeneratedClip, clip: ClipRegion) => {
      setGeneratingClipId(null);
      onClipCreated(result);
      updateClip(clip.id, { generated: true, generatedUrl: result.clipUrl });
      toast.success('Clip generated successfully');
    },
    onError: (error: Error) => {
      setGeneratingClipId(null);
      toast.error(`Failed to generate clip: ${error.message}`);
    },
  });

  const handleGenerate = useCallback(
    (clip: ClipRegion) => {
      generateMutation.mutate(clip);
    },
    [generateMutation],
  );

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Video Preview */}
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardContent className="p-4">
            {/* Video Container with Vertical Preview Overlay */}
            <div className="relative overflow-hidden rounded-lg bg-black">
              <video
                ref={videoRef}
                src={videoUrl}
                className="aspect-video w-full"
                playsInline
              />

              {/* 9:16 Preview Overlay */}
              {selectedClip && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div
                    className="border-2 border-dashed border-white/50 bg-black/20"
                    style={{
                      width: `${(9 / 16) * 100}%`,
                      height: '100%',
                      transform: `translateX(${(selectedClip.cropSettings.x - 0.5) * 100}%)`,
                    }}
                  />
                </div>
              )}
            </div>

            {/* Transport Controls */}
            <div className="mt-4 space-y-2">
              {/* Timeline */}
              <TimelineSlider
                duration={duration}
                currentTime={currentTime}
                clips={clips}
                selectedClipId={selectedClipId}
                onSeek={seekTo}
                onClipSelect={setSelectedClipId}
              />

              {/* Playback Controls */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="icon" onClick={togglePlay}>
                    {isPlaying ? (
                      <Pause className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </Button>
                  <span className="font-mono text-sm">
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>
                </div>

                <Button onClick={addClip}>
                  <Scissors className="mr-2 h-4 w-4" />
                  Mark Clip at {formatTime(currentTime)}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Clips Panel */}
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Clips ({clips.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {clips.length === 0 ? (
              <div className="text-muted-foreground py-8 text-center">
                <Scissors className="mx-auto mb-2 h-8 w-8 opacity-50" />
                <p>No clips yet</p>
                <p className="text-sm">
                  Play the video and mark moments to create clips
                </p>
              </div>
            ) : (
              clips.map((clip) => (
                <ClipCard
                  key={clip.id}
                  clip={clip}
                  isSelected={selectedClipId === clip.id}
                  isGenerating={generatingClipId === clip.id}
                  onSelect={() => {
                    setSelectedClipId(clip.id);
                    seekTo(clip.startTime);
                  }}
                  onDelete={() => deleteClip(clip.id)}
                  onGenerate={() => handleGenerate(clip)}
                />
              ))
            )}
          </CardContent>
        </Card>

        {/* Selected Clip Editor */}
        {selectedClip && (
          <ClipEditor
            clip={selectedClip}
            duration={duration}
            onUpdate={(updates) => updateClip(selectedClip.id, updates)}
          />
        )}
      </div>
    </div>
  );
}

interface ClipCardProps {
  clip: ClipRegion;
  isSelected: boolean;
  isGenerating: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onGenerate: () => void;
}

function ClipCard({
  clip,
  isSelected,
  isGenerating,
  onSelect,
  onDelete,
  onGenerate,
}: ClipCardProps) {
  const clipDuration = clip.endTime - clip.startTime;

  return (
    <div
      className={`cursor-pointer rounded-lg border p-3 transition-colors ${
        isSelected
          ? 'border-primary bg-primary/5'
          : 'hover:border-muted-foreground/50'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{clip.title}</div>
          <div className="text-muted-foreground text-sm">
            {formatTime(clip.startTime)} - {formatTime(clip.endTime)}
            <Badge variant="secondary" className="ml-2">
              {formatTime(clipDuration)}
            </Badge>
          </div>
        </div>

        <div className="flex gap-1">
          {clip.generated ? (
            <Badge variant="default" className="bg-green-500">
              Generated
            </Badge>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onGenerate();
              }}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <RefreshCw className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

interface ClipEditorProps {
  clip: ClipRegion;
  duration: number;
  onUpdate: (updates: Partial<ClipRegion>) => void;
}

function ClipEditor({ clip, duration, onUpdate }: ClipEditorProps) {
  const handleCropTypeChange = useCallback(
    (type: 'left' | 'center' | 'right', x: number) => {
      onUpdate({
        cropSettings: { ...clip.cropSettings, type, x },
      });
    },
    [clip.cropSettings, onUpdate],
  );

  const handleCustomPosition = useCallback(
    (value: number[]) => {
      onUpdate({
        cropSettings: {
          ...clip.cropSettings,
          type: 'custom',
          x: (value[0] ?? 50) / 100,
        },
      });
    },
    [clip.cropSettings, onUpdate],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Edit Clip</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Title */}
        <div className="space-y-2">
          <Label>Clip Title</Label>
          <Input
            value={clip.title}
            onChange={(e) => onUpdate({ title: e.target.value })}
          />
        </div>

        {/* Time Range */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Start</Label>
            <Input
              type="number"
              value={clip.startTime.toFixed(1)}
              onChange={(e) =>
                onUpdate({ startTime: parseFloat(e.target.value) || 0 })
              }
              step="0.1"
              min={0}
              max={clip.endTime - 3}
            />
          </div>
          <div className="space-y-2">
            <Label>End</Label>
            <Input
              type="number"
              value={clip.endTime.toFixed(1)}
              onChange={(e) =>
                onUpdate({ endTime: parseFloat(e.target.value) || 0 })
              }
              step="0.1"
              min={clip.startTime + 3}
              max={duration}
            />
          </div>
        </div>

        <div className="text-muted-foreground text-sm">
          Duration: {formatTime(clip.endTime - clip.startTime)}
        </div>

        {/* Crop Position */}
        <div className="space-y-2">
          <Label>Vertical Crop Position</Label>
          <div className="flex gap-2">
            <Button
              variant={
                clip.cropSettings.type === 'left' ? 'default' : 'outline'
              }
              size="sm"
              onClick={() => handleCropTypeChange('left', 0.25)}
            >
              <AlignHorizontalJustifyStart className="h-4 w-4" />
            </Button>
            <Button
              variant={
                clip.cropSettings.type === 'center' ? 'default' : 'outline'
              }
              size="sm"
              onClick={() => handleCropTypeChange('center', 0.5)}
            >
              <AlignHorizontalJustifyCenter className="h-4 w-4" />
            </Button>
            <Button
              variant={
                clip.cropSettings.type === 'right' ? 'default' : 'outline'
              }
              size="sm"
              onClick={() => handleCropTypeChange('right', 0.75)}
            >
              <AlignHorizontalJustifyEnd className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Fine-tune position */}
        <div className="space-y-2">
          <Label>Fine-tune Position</Label>
          <Slider
            value={[clip.cropSettings.x * 100]}
            onValueChange={handleCustomPosition}
            min={0}
            max={100}
            step={1}
          />
        </div>
      </CardContent>
    </Card>
  );
}

interface TimelineSliderProps {
  duration: number;
  currentTime: number;
  clips: ClipRegion[];
  selectedClipId: string | null;
  onSeek: (time: number) => void;
  onClipSelect: (id: string) => void;
}

function TimelineSlider({
  duration,
  currentTime,
  clips,
  selectedClipId,
  onSeek,
  onClipSelect,
}: TimelineSliderProps) {
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const newTime = (x / rect.width) * duration;
      onSeek(newTime);
    },
    [duration, onSeek],
  );

  return (
    <div
      className="bg-muted relative h-8 cursor-pointer rounded"
      onClick={handleClick}
    >
      {/* Clip regions */}
      {clips.map((clip) => (
        <div
          key={clip.id}
          className={`absolute h-full cursor-pointer rounded transition-opacity ${
            selectedClipId === clip.id
              ? 'bg-primary/50'
              : 'bg-primary/30 hover:bg-primary/40'
          }`}
          style={{
            left: `${(clip.startTime / duration) * 100}%`,
            width: `${((clip.endTime - clip.startTime) / duration) * 100}%`,
          }}
          onClick={(e) => {
            e.stopPropagation();
            onClipSelect(clip.id);
          }}
        />
      ))}

      {/* Playhead */}
      <div
        className="pointer-events-none absolute top-0 h-full w-0.5 bg-white shadow-lg"
        style={{ left: `${(currentTime / duration) * 100}%` }}
      />
    </div>
  );
}
