import { Clapperboard, Film, Mic, Plus } from 'lucide-react';

import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@kit/ui/command';

export function Default() {
  return (
    <CommandDialog open={true} onOpenChange={() => {}}>
      <CommandInput placeholder="Search episodes, projects, actions..." />
      <CommandList>
        <CommandGroup heading="Quick actions">
          <CommandItem>
            <Plus className="mr-2 h-4 w-4" />
            New episode
            <CommandShortcut>⌘N</CommandShortcut>
          </CommandItem>
          <CommandItem>
            <Mic className="mr-2 h-4 w-4" />
            Open Audio Studio
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Episodes">
          <CommandItem>
            <Film className="mr-2 h-4 w-4" />
            S2E04 — The Lighthouse Keeper&apos;s Secret
          </CommandItem>
          <CommandItem>
            <Clapperboard className="mr-2 h-4 w-4" />
            S2E05 — Tides of Silence
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
