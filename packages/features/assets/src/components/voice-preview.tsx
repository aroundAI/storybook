'use client';

import { useEffect, useRef, useState } from 'react';

import { Loader2, Pause, Play, RefreshCw } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Slider } from '@kit/ui/slider';

interface VoicePreviewProps {
  audioUrl: string | null;
  isGenerating: boolean;
  onGenerate: () => void;
}

export function VoicePreview({
  audioUrl,
  isGenerating,
  onGenerate,
}: VoicePreviewProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (audioUrl) {
      audioRef.current = new Audio(audioUrl);

      audioRef.current.addEventListener('loadedmetadata', () => {
        setDuration(audioRef.current?.duration ?? 0);
      });

      audioRef.current.addEventListener('timeupdate', () => {
        setCurrentTime(audioRef.current?.currentTime ?? 0);
      });

      audioRef.current.addEventListener('ended', () => {
        setIsPlaying(false);
        setCurrentTime(0);
      });
    }

    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, [audioUrl]);

  const handlePlayPause = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleSeek = (value: number[]) => {
    if (!audioRef.current) return;

    audioRef.current.currentTime = value[0] ?? 0;
    setCurrentTime(value[0] ?? 0);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      {audioUrl ? (
        <>
          {/* Playback Controls */}
          <div className="flex items-center gap-4">
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={handlePlayPause}
            >
              {isPlaying ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>

            <div className="flex-1">
              <Slider
                value={[currentTime]}
                onValueChange={handleSeek}
                min={0}
                max={duration}
                step={0.1}
              />
            </div>

            <span className="text-sm text-muted-foreground tabular-nums">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onGenerate}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
        </>
      ) : (
        <div className="py-6 text-center">
          <p className="mb-4 text-sm text-muted-foreground">
            Generate a preview to hear how this voice sounds
          </p>
          <Button type="button" onClick={onGenerate} disabled={isGenerating}>
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              'Generate Preview'
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
