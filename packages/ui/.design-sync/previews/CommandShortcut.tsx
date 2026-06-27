import {
  Clapperboard,
  FileText,
  Film,
  Mic,
  Plus,
  Settings,
} from 'lucide-react';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@kit/ui/command';

export function Default() {
  return (
    <Command className="w-[420px] rounded-lg border shadow-md">
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
          <CommandItem>
            <FileText className="mr-2 h-4 w-4" />
            Season 2 Facts Pipeline
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Settings">
          <CommandItem>
            <Settings className="mr-2 h-4 w-4" />
            Project settings
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

export function EmptyState() {
  return (
    <Command className="w-[420px] rounded-lg border shadow-md">
      <CommandInput placeholder="Search episodes, projects, actions..." />
      <CommandList>
        <CommandEmpty>No results found for &quot;xq&quot;.</CommandEmpty>
      </CommandList>
    </Command>
  );
}
