'use client';

import { useState } from 'react';

import { useRouter } from 'next/navigation';

import { MapPin, Mic, Plus, User } from 'lucide-react';

import { CharacterEditor, LocationEditor } from '@kit/assets/components';
import { VoiceProfileEditor } from '@kit/assets/components';
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
  account: string;
}

type AssetDialogType = 'character' | 'location' | 'voice' | null;

export function CreateAssetButton({
  projectId,
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
          <DropdownMenuItem onClick={() => handleCreate('voice')}>
            <Mic className="mr-2 h-4 w-4" />
            Create Voice Profile
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
            onSuccess={handleSuccess}
            onCancel={handleCancel}
          />
        </DialogContent>
      </Dialog>

      {/* Voice Profile Dialog */}
      <Dialog
        open={openDialog === 'voice'}
        onOpenChange={(open) => !open && handleCancel()}
      >
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Voice Profile</DialogTitle>
          </DialogHeader>
          <VoiceProfileEditor
            projectId={projectId}
            onSuccess={handleSuccess}
            onCancel={handleCancel}
          />
        </DialogContent>
      </Dialog>

      {/* Location Dialog - Placeholder for now */}
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
