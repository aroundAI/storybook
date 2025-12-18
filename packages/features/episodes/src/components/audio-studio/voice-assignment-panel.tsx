'use client';

import { Button } from '@kit/ui/button';
import { cn } from '@kit/ui/utils';

import { MaterialIcon } from '../ui';

export interface Character {
  id: string;
  name: string;
  role: string;
  voiceDescription: string;
  status: 'active' | 'pending' | 'inactive';
  color: 'orange' | 'purple' | 'green' | 'blue';
}

export interface VoiceAssignmentPanelProps {
  characters?: Character[];
}

// Placeholder data matching the design
const DEFAULT_CHARACTERS: Character[] = [
  {
    id: '1',
    name: 'Dante',
    role: 'Main Character',
    voiceDescription: 'Young Boy • Energetic',
    status: 'active',
    color: 'orange',
  },
  {
    id: '2',
    name: 'Origami Lion',
    role: 'Side Character',
    voiceDescription: 'Deep • Wise',
    status: 'pending',
    color: 'purple',
  },
  {
    id: '3',
    name: 'Cece',
    role: 'Main Character',
    voiceDescription: 'High Pitch • Excited',
    status: 'active',
    color: 'green',
  },
];

export function VoiceAssignmentPanel({
  characters = DEFAULT_CHARACTERS,
}: VoiceAssignmentPanelProps) {
  const getColorClasses = (color: Character['color']) => {
    const colorMap = {
      orange: {
        border: 'border-l-orange-400',
        bg: 'bg-orange-100 dark:bg-orange-100',
        text: 'text-orange-600 dark:text-orange-600',
      },
      purple: {
        border: 'border-l-purple-400',
        bg: 'bg-purple-100 dark:bg-purple-100',
        text: 'text-purple-600 dark:text-purple-600',
      },
      green: {
        border: 'border-l-green-400',
        bg: 'bg-green-100 dark:bg-green-100',
        text: 'text-green-600 dark:text-green-600',
      },
      blue: {
        border: 'border-l-blue-400',
        bg: 'bg-blue-100 dark:bg-blue-100',
        text: 'text-blue-600 dark:text-blue-600',
      },
    };

    return colorMap[color];
  };

  const getStatusDotColor = (status: Character['status']) => {
    switch (status) {
      case 'active':
        return 'bg-green-500';
      case 'pending':
        return 'bg-yellow-400';
      case 'inactive':
        return 'bg-gray-300';
      default:
        return 'bg-gray-300';
    }
  };

  return (
    <div className="border-border bg-surface flex h-full flex-col rounded-2xl border shadow-sm">
      {/* Header */}
      <div className="border-border flex items-center justify-between border-b p-4">
        <div className="flex items-center gap-2">
          <MaterialIcon name="record_voice_over" className="text-primary" />
          <h3 className="text-sm font-semibold">Voice Assignment</h3>
        </div>
        <Button variant="link" size="sm" className="h-auto p-0 text-xs">
          Manage All
        </Button>
      </div>

      {/* Character Cards */}
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {characters.map((character) => {
          const colors = getColorClasses(character.color);

          return (
            <div
              key={character.id}
              className={cn(
                'bg-background group relative cursor-pointer rounded-xl border border-l-4 p-3 shadow-sm transition-all hover:shadow-md',
                colors.border,
              )}
            >
              {/* Character Info */}
              <div className="mb-2 flex items-start justify-between">
                <div className="flex items-center gap-3">
                  {/* Avatar */}
                  <div
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold',
                      colors.bg,
                      colors.text,
                    )}
                  >
                    {character.name.charAt(0)}
                  </div>

                  {/* Name & Role */}
                  <div>
                    <h4 className="text-sm font-semibold">{character.name}</h4>
                    <p className="text-muted-foreground text-[10px]">
                      {character.role}
                    </p>
                  </div>
                </div>

                {/* Status Dot */}
                <div
                  className={cn(
                    'h-2 w-2 rounded-full',
                    getStatusDotColor(character.status),
                  )}
                ></div>
              </div>

              {/* Voice Description & Edit */}
              <div className="flex items-center justify-between">
                <span className="bg-muted text-muted-foreground rounded-md px-2 py-0.5 text-[10px]">
                  {character.voiceDescription}
                </span>
                <button className="text-muted-foreground hover:text-primary transition-colors">
                  <MaterialIcon name="edit" className="text-sm" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
