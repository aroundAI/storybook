'use client';

import { useEffect, useState } from 'react';

import { MapPin, Plus, User } from 'lucide-react';

import { Button } from '@kit/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';

import { useAssetCreate } from './asset-create-provider';

export function CreateAssetButton() {
  const { openCreate } = useAssetCreate();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isShortcut =
        event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey);

      if (!isShortcut || event.altKey || event.shiftKey) return;

      event.preventDefault();
      setMenuOpen(true);
    };

    document.addEventListener('keydown', onKeyDown);

    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          title="Create asset (Ctrl+K or Cmd+K)"
          aria-keyshortcuts="Control+K Meta+K"
          data-test="create-asset-button"
        >
          <Plus className="mr-2 h-4 w-4" />
          Create Asset
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => openCreate('character')}
          data-test="create-character-item"
        >
          <User className="mr-2 h-4 w-4" />
          Create Character
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => openCreate('location')}
          data-test="create-location-item"
        >
          <MapPin className="mr-2 h-4 w-4" />
          Create Location
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
