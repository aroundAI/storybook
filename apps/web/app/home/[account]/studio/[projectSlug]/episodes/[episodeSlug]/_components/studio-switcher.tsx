'use client';

import { usePathname, useRouter } from 'next/navigation';

import { BookOpen, ChevronDown, Music } from 'lucide-react';

import { Button } from '@kit/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';

type StudioMode = 'story' | 'audio';

export function StudioSwitcher() {
  const pathname = usePathname();
  const router = useRouter();

  // Determine current studio mode based on path
  const isAudioStudio = pathname.includes('/audio-studio');
  const currentMode: StudioMode = isAudioStudio ? 'audio' : 'story';

  const handleModeChange = (mode: StudioMode) => {
    // Extract base path (everything up to and including episodeId)
    const pathParts = pathname.split('/');
    const episodeIdIndex = pathParts.findIndex(
      (part, i) => pathParts[i - 1] === 'episodes' && part !== 'episodes',
    );

    if (episodeIdIndex === -1) return;

    const basePath = pathParts.slice(0, episodeIdIndex + 1).join('/');

    if (mode === 'audio') {
      router.push(`${basePath}/audio-studio`);
    } else {
      // Default to ideation for story studio
      router.push(`${basePath}/ideation`);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 rounded-lg border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800"
        >
          {currentMode === 'audio' ? (
            <>
              <Music className="h-4 w-4 text-blue-600" />
              <span className="font-medium">Audio Studio</span>
            </>
          ) : (
            <>
              <BookOpen className="h-4 w-4 text-blue-600" />
              <span className="font-medium">Story Studio</span>
            </>
          )}
          <ChevronDown className="h-4 w-4 text-gray-400" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem
          onClick={() => handleModeChange('story')}
          className="gap-2"
        >
          <BookOpen className="h-4 w-4" />
          <span>Story Studio</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => handleModeChange('audio')}
          className="gap-2"
        >
          <Music className="h-4 w-4" />
          <span>Audio Studio</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
