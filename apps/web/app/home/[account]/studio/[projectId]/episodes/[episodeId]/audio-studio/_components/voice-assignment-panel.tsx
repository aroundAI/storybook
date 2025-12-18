'use client';

import { useState } from 'react';

import { Mic, User } from 'lucide-react';

import { Button } from '@kit/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { cn } from '@kit/ui/utils';

interface VoiceAssignmentPanelProps {
  characters: string[];
  episodeId: string;
}

// Placeholder voice options
const VOICE_OPTIONS = [
  { id: 'unassigned', name: 'Not Assigned', provider: 'none' },
  { id: 'voice-1', name: 'Alex (Male)', provider: 'ElevenLabs' },
  { id: 'voice-2', name: 'Sarah (Female)', provider: 'ElevenLabs' },
  { id: 'voice-3', name: 'James (Male)', provider: 'ElevenLabs' },
  { id: 'voice-4', name: 'Emma (Female)', provider: 'ElevenLabs' },
];

// Generate consistent colors for characters
function getCharacterColor(name: string): string {
  const colors = [
    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
    'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  ];

  const hash = name
    .split('')
    .reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length]!;
}

export function VoiceAssignmentPanel({
  characters,
  episodeId: _episodeId,
}: VoiceAssignmentPanelProps) {
  const [voiceAssignments, setVoiceAssignments] = useState<
    Record<string, string>
  >({});

  const handleVoiceChange = (character: string, voiceId: string) => {
    setVoiceAssignments((prev) => ({
      ...prev,
      [character]: voiceId,
    }));
    // TODO: Persist to database
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-gray-200 p-4 dark:border-gray-700">
        <h3 className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
          <Mic className="h-5 w-5" />
          Voice Assignment
        </h3>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Assign voices to each character
        </p>
      </div>

      {/* Character List */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-3">
          {characters.map((character) => {
            const assignedVoice = voiceAssignments[character] ?? 'unassigned';
            const _voice = VOICE_OPTIONS.find((v) => v.id === assignedVoice);

            return (
              <div
                key={character}
                className="rounded-xl border border-gray-100 bg-gray-50 p-3 transition-colors hover:border-gray-200 dark:border-gray-700 dark:bg-gray-800/50 dark:hover:border-gray-600"
              >
                {/* Character Name */}
                <div className="mb-2 flex items-center gap-2">
                  <div
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-full',
                      getCharacterColor(character),
                    )}
                  >
                    <User className="h-4 w-4" />
                  </div>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {character}
                  </span>
                </div>

                {/* Voice Selector */}
                <Select
                  value={assignedVoice}
                  onValueChange={(v) => handleVoiceChange(character, v)}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Select voice..." />
                  </SelectTrigger>
                  <SelectContent>
                    {VOICE_OPTIONS.map((voice) => (
                      <SelectItem key={voice.id} value={voice.id}>
                        <div className="flex items-center gap-2">
                          <span>{voice.name}</span>
                          {voice.provider !== 'none' && (
                            <span className="text-xs text-gray-400">
                              {voice.provider}
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Preview Button (when voice is assigned) */}
                {assignedVoice !== 'unassigned' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 w-full text-xs"
                    onClick={() => {
                      // TODO: Play voice preview
                    }}
                  >
                    <Mic className="mr-1 h-3 w-3" />
                    Preview Voice
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        {characters.length === 0 && (
          <div className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No characters found in dialogue
          </div>
        )}
      </div>
    </div>
  );
}
