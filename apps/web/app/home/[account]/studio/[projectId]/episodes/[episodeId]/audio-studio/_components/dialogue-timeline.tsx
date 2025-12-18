'use client';

import { useMemo } from 'react';

import { Play, User, Volume2 } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { cn } from '@kit/ui/utils';

interface DialogueLine {
  character: string;
  text: string;
  parenthetical?: string;
  sceneNumber: number;
  lineIndex: number;
}

interface DialogueTimelineProps {
  dialogueLines: DialogueLine[];
  characters: string[];
}

// Generate consistent colors for characters
type CharacterColors = {
  bg: string;
  border: string;
  text: string;
};

const COLORS: CharacterColors[] = [
  {
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    border: 'border-blue-200 dark:border-blue-800',
    text: 'text-blue-700 dark:text-blue-400',
  },
  {
    bg: 'bg-purple-50 dark:bg-purple-900/20',
    border: 'border-purple-200 dark:border-purple-800',
    text: 'text-purple-700 dark:text-purple-400',
  },
  {
    bg: 'bg-green-50 dark:bg-green-900/20',
    border: 'border-green-200 dark:border-green-800',
    text: 'text-green-700 dark:text-green-400',
  },
  {
    bg: 'bg-orange-50 dark:bg-orange-900/20',
    border: 'border-orange-200 dark:border-orange-800',
    text: 'text-orange-700 dark:text-orange-400',
  },
  {
    bg: 'bg-pink-50 dark:bg-pink-900/20',
    border: 'border-pink-200 dark:border-pink-800',
    text: 'text-pink-700 dark:text-pink-400',
  },
  {
    bg: 'bg-cyan-50 dark:bg-cyan-900/20',
    border: 'border-cyan-200 dark:border-cyan-800',
    text: 'text-cyan-700 dark:text-cyan-400',
  },
];

function getCharacterColor(name: string): CharacterColors {
  const hash = name
    .split('')
    .reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return COLORS[hash % COLORS.length]!;
}

export function DialogueTimeline({
  dialogueLines,
  characters: _characters,
}: DialogueTimelineProps) {
  // Group dialogue by scene
  const linesByScene = useMemo(() => {
    const grouped: Record<number, DialogueLine[]> = {};
    dialogueLines.forEach((line) => {
      if (!grouped[line.sceneNumber]) {
        grouped[line.sceneNumber] = [];
      }
      grouped[line.sceneNumber]!.push(line);
    });
    return grouped;
  }, [dialogueLines]);

  const sceneNumbers = Object.keys(linesByScene)
    .map(Number)
    .sort((a, b) => a - b);

  return (
    <div className="h-full overflow-y-auto bg-gray-100 p-6 dark:bg-gray-900">
      {/* Timeline */}
      <div className="mx-auto max-w-4xl space-y-6">
        {sceneNumbers.map((sceneNum) => (
          <div key={sceneNum}>
            {/* Scene Header */}
            <div className="mb-3 flex items-center gap-3">
              <h3 className="text-sm font-bold tracking-wider text-gray-400 uppercase dark:text-gray-500">
                Scene {sceneNum}
              </h3>
              <div className="h-px flex-1 bg-gray-300 dark:bg-gray-700" />
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {linesByScene[sceneNum]!.length} line
                {linesByScene[sceneNum]!.length !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Dialogue Lines */}
            <div className="space-y-2">
              {linesByScene[sceneNum]!.map((line, index) => {
                const colors = getCharacterColor(line.character);
                const hasAudio = false; // TODO: Check if line has generated audio

                return (
                  <div
                    key={`${sceneNum}-${index}`}
                    className={cn(
                      'group flex items-start gap-3 rounded-xl border p-4 transition-colors',
                      colors.bg,
                      colors.border,
                    )}
                  >
                    {/* Character Avatar */}
                    <div
                      className={cn(
                        'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2',
                        colors.border,
                        colors.text,
                      )}
                    >
                      <User className="h-5 w-5" />
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      {/* Character Name */}
                      <div className="mb-1 flex items-center gap-2">
                        <span
                          className={cn(
                            'text-sm font-bold uppercase',
                            colors.text,
                          )}
                        >
                          {line.character}
                        </span>
                        {line.parenthetical && (
                          <span className="text-xs text-gray-500 italic dark:text-gray-400">
                            ({line.parenthetical})
                          </span>
                        )}
                      </div>

                      {/* Dialogue Text */}
                      <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                        {line.text}
                      </p>

                      {/* Audio Waveform Placeholder */}
                      {hasAudio && (
                        <div className="mt-2 h-8 rounded bg-gray-200 dark:bg-gray-700">
                          {/* TODO: Show actual waveform */}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      {hasAudio ? (
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <Play className="h-4 w-4" />
                        </Button>
                      ) : (
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <Volume2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {sceneNumbers.length === 0 && (
          <div className="flex h-64 items-center justify-center text-gray-500 dark:text-gray-400">
            <div className="text-center">
              <Volume2 className="mx-auto mb-3 h-12 w-12 opacity-30" />
              <p>No dialogue lines found</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
