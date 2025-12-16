'use client';

import { useRef, useState } from 'react';

import { Check, Pause, Play, Search } from 'lucide-react';

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
import { cn } from '@kit/ui/utils';

/**
 * Voice option type for selector (simplified from Voice type)
 */
export interface VoiceOption {
  id: string;
  name: string;
  provider: string;
  language: string;
  gender?: 'male' | 'female' | 'neutral';
  age?: string;
  accent?: string;
  description?: string;
  previewUrl?: string;
  isCloned?: boolean;
}

export interface VoiceSelectorProps {
  voices: VoiceOption[];
  selectedVoiceId: string | null;
  onSelectVoice: (voiceId: string) => void;
  isLoading?: boolean;
  filters: {
    language: string;
    gender: string;
    search: string;
  };
  onFiltersChange: (filters: {
    language: string;
    gender: string;
    search: string;
  }) => void;
}

// Language options from ElevenLabs supported languages
const LANGUAGE_OPTIONS = [
  { value: 'all', label: 'All Languages' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'pl', label: 'Polish' },
  { value: 'hi', label: 'Hindi' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'zh', label: 'Chinese' },
];

const GENDER_OPTIONS = [
  { value: 'all', label: 'All Genders' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'neutral', label: 'Neutral' },
];

export function VoiceSelector({
  voices,
  selectedVoiceId,
  onSelectVoice,
  isLoading = false,
  filters,
  onFiltersChange,
}: VoiceSelectorProps) {
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handlePlayPreview = (voice: VoiceOption, e: React.MouseEvent) => {
    e.stopPropagation();

    if (!voice.previewUrl) return;

    // Stop current audio if playing
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    // If clicking same voice, just stop
    if (playingVoiceId === voice.id) {
      setPlayingVoiceId(null);
      return;
    }

    // Play new audio
    const audio = new Audio(voice.previewUrl);
    audioRef.current = audio;
    setPlayingVoiceId(voice.id);

    audio.play().catch(() => {
      setPlayingVoiceId(null);
    });

    audio.onended = () => {
      setPlayingVoiceId(null);
      audioRef.current = null;
    };
  };

  const handleLanguageChange = (value: string) => {
    onFiltersChange({ ...filters, language: value });
  };

  const handleGenderChange = (value: string) => {
    onFiltersChange({ ...filters, gender: value });
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onFiltersChange({ ...filters, search: e.target.value });
  };

  // Filter voices by search term (client-side for immediate feedback)
  const filteredVoices = voices.filter((voice) => {
    if (!filters.search) return true;
    const searchLower = filters.search.toLowerCase();
    return (
      voice.name.toLowerCase().includes(searchLower) ||
      voice.description?.toLowerCase().includes(searchLower) ||
      voice.accent?.toLowerCase().includes(searchLower)
    );
  });

  return (
    <div className="space-y-4">
      <Label className="text-base font-medium">Select Voice</Label>

      {/* Filters */}
      <div className="flex gap-2">
        <Select value={filters.language} onValueChange={handleLanguageChange}>
          <SelectTrigger className="w-36" data-test="language-filter">
            <SelectValue placeholder="Language" />
          </SelectTrigger>
          <SelectContent>
            {LANGUAGE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.gender} onValueChange={handleGenderChange}>
          <SelectTrigger className="w-32" data-test="gender-filter">
            <SelectValue placeholder="Gender" />
          </SelectTrigger>
          <SelectContent>
            {GENDER_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
        <Input
          placeholder="Search voices..."
          value={filters.search}
          onChange={handleSearchChange}
          className="pl-10"
          data-test="voice-search"
        />
      </div>

      {/* Voice List */}
      <div className="max-h-96 space-y-2 overflow-y-auto" role="listbox">
        {isLoading ? (
          <div className="text-muted-foreground py-8 text-center text-sm">
            <div className="mx-auto mb-2 h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Loading voices...
          </div>
        ) : filteredVoices.length === 0 ? (
          <div className="text-muted-foreground py-8 text-center text-sm">
            No voices found matching your criteria
          </div>
        ) : (
          filteredVoices.map((voice) => {
            const isSelected = selectedVoiceId === voice.id;
            const isPlaying = playingVoiceId === voice.id;

            return (
              <button
                key={voice.id}
                onClick={() => onSelectVoice(voice.id)}
                role="option"
                aria-selected={isSelected}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                  'hover:bg-accent focus:ring-ring focus:outline-none focus:ring-2',
                  isSelected && 'border-primary bg-primary/5',
                )}
                data-test={`voice-item-${voice.id}`}
              >
                {/* Selection indicator */}
                <div
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                    isSelected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-muted-foreground/30',
                  )}
                >
                  {isSelected && <Check className="h-3 w-3" />}
                </div>

                {/* Voice info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{voice.name}</span>
                    {voice.isCloned && (
                      <span className="bg-secondary text-secondary-foreground rounded px-1.5 py-0.5 text-xs">
                        Cloned
                      </span>
                    )}
                  </div>
                  <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                    {voice.gender && (
                      <span className="capitalize">{voice.gender}</span>
                    )}
                    {voice.age && (
                      <>
                        <span>•</span>
                        <span className="capitalize">{voice.age}</span>
                      </>
                    )}
                    {voice.accent && (
                      <>
                        <span>•</span>
                        <span>{voice.accent}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Preview button */}
                {voice.previewUrl && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => handlePlayPreview(voice, e)}
                    aria-label={isPlaying ? 'Stop preview' : 'Play preview'}
                    data-test={`play-voice-${voice.id}`}
                  >
                    {isPlaying ? (
                      <Pause className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </Button>
                )}
              </button>
            );
          })
        )}
      </div>

      {/* Voice count */}
      {!isLoading && (
        <p className="text-muted-foreground text-xs">
          {filteredVoices.length} voice{filteredVoices.length !== 1 ? 's' : ''}{' '}
          available
        </p>
      )}
    </div>
  );
}
