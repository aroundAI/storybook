'use client';

import { useMemo, useState } from 'react';

import { Search } from 'lucide-react';

import { Input } from '@kit/ui/input';

import { VoiceCard, type VoiceOption } from './voice-card';

interface VoiceSelectorProps {
  voices: VoiceOption[];
  selectedVoiceId: string;
  onSelect: (voiceId: string) => void;
}

export function VoiceSelector({
  voices,
  selectedVoiceId,
  onSelect,
}: VoiceSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // Filter voices by search query
  const filteredVoices = useMemo(() => {
    if (!searchQuery) return voices;

    const query = searchQuery.toLowerCase();
    return voices.filter(
      (voice) =>
        voice.name.toLowerCase().includes(query) ||
        voice.description?.toLowerCase().includes(query) ||
        voice.accent?.toLowerCase().includes(query),
    );
  }, [voices, searchQuery]);

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
        <Input
          type="text"
          placeholder="Search voices..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Voice Grid */}
      <div className="grid max-h-96 grid-cols-1 gap-4 overflow-y-auto md:grid-cols-2">
        {filteredVoices.map((voice) => (
          <VoiceCard
            key={voice.id}
            voice={voice}
            isSelected={voice.id === selectedVoiceId}
            onSelect={() => onSelect(voice.id)}
          />
        ))}
      </div>

      {filteredVoices.length === 0 && (
        <div className="text-muted-foreground py-8 text-center">
          No voices found matching &quot;{searchQuery}&quot;
        </div>
      )}
    </div>
  );
}
