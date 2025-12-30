'use client';

import { useState } from 'react';

import { useRouter } from 'next/navigation';

import { MapPin, Plus, User } from 'lucide-react';

import { CharacterEditor, LocationEditor } from '@kit/assets/components';
import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';

interface CreateAssetButtonProps {
  projectId: string;
  accountId: string;
  account: string;
}

type AssetDialogType = 'character' | 'location' | null;

export function CreateAssetButton({
  projectId,
  accountId,
  account: _account,
}: CreateAssetButtonProps) {
  const router = useRouter();
  const [openDialog, setOpenDialog] = useState<AssetDialogType>(null);

  const handleCreate = (type: AssetDialogType) => {
    setOpenDialog(type);
  };

  const handleSuccess = (_result: unknown) => {
    setOpenDialog(null);
    router.refresh(); // Refresh to show new asset
  };

  const handleCancel = () => {
    setOpenDialog(null);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Create Asset
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => handleCreate('character')}>
            <User className="mr-2 h-4 w-4" />
            Create Character
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleCreate('location')}>
            <MapPin className="mr-2 h-4 w-4" />
            Create Location
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Character Dialog */}
      <Dialog
        open={openDialog === 'character'}
        onOpenChange={(open) => !open && handleCancel()}
      >
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Character</DialogTitle>
          </DialogHeader>
          <CharacterEditor
            projectId={projectId}
            accountId={accountId}
            onSuccess={handleSuccess}
            onCancel={handleCancel}
          />
        </DialogContent>
      </Dialog>

      {/* Location Dialog */}
      <Dialog
        open={openDialog === 'location'}
        onOpenChange={(open) => !open && handleCancel()}
      >
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Location</DialogTitle>
          </DialogHeader>
          <LocationEditor
            projectId={projectId}
            onSuccess={handleSuccess}
            onCancel={handleCancel}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
