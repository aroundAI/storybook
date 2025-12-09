'use client';

import { useState } from 'react';

import { Check, Pause, Play } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Card, CardContent } from '@kit/ui/card';

export interface VoiceOption {
  id: string;
  name: string;
  gender?: string;
  age?: string;
  accent?: string;
  description?: string;
  previewUrl?: string;
  category?: 'premade' | 'cloned' | 'generated';
}

interface VoiceCardProps {
  voice: VoiceOption;
  isSelected: boolean;
  onSelect: () => void;
}

export function VoiceCard({ voice, isSelected, onSelect }: VoiceCardProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);

  const handlePlayPause = (e: React.MouseEvent) => {
    e.stopPropagation();

    if (!voice.previewUrl) return;

    if (isPlaying && audio) {
      audio.pause();
      setIsPlaying(false);
    } else {
      const newAudio = new Audio(voice.previewUrl);
      newAudio.onended = () => setIsPlaying(false);
      newAudio.play();
      setAudio(newAudio);
      setIsPlaying(true);
    }
  };

  return (
    <Card
      className={`cursor-pointer transition-all ${
        isSelected ? 'ring-primary ring-2' : 'hover:border-primary'
      }`}
      onClick={onSelect}
    >
      <CardContent className="p-4">
        <div className="mb-2 flex items-start justify-between">
          <div className="flex-1">
            <h4 className="text-sm font-semibold">{voice.name}</h4>
            <p className="text-muted-foreground text-xs">
              {[voice.gender, voice.age, voice.accent]
                .filter(Boolean)
                .join(' • ')}
            </p>
          </div>
          {isSelected && (
            <Check className="text-primary h-5 w-5 flex-shrink-0" />
          )}
        </div>

        {voice.description && (
          <p className="text-muted-foreground mb-3 line-clamp-2 text-xs">
            {voice.description}
          </p>
        )}

        <div className="flex items-center justify-between">
          <div className="flex gap-1">
            {voice.category && (
              <Badge variant="secondary" className="text-xs">
                {voice.category}
              </Badge>
            )}
          </div>

          {voice.previewUrl && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handlePlayPause}
            >
              {isPlaying ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
