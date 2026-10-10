'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import { ProjectChannelPicker } from '@kit/publishing/components';
import { getConnectedPlatformsAction } from '@kit/publishing/server';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@kit/ui/sheet';

interface ProjectChannelsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  accountSlug?: string;
  projectId: string;
  selectedIds: string[];
  onSaved: () => void;
}

/** Chooses the project's channels without leaving the Publish screen */
export function ProjectChannelsSheet({
  open,
  onOpenChange,
  accountId,
  accountSlug,
  projectId,
  selectedIds,
  onSaved,
}: ProjectChannelsSheetProps) {
  const { data: teamChannels, isLoading } = useQuery({
    queryKey: ['platform-connections', accountId],
    queryFn: () => getConnectedPlatformsAction({ accountId }),
    enabled: open,
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>This project&apos;s channels</SheetTitle>
          <SheetDescription>
            Episodes in this project publish only to the channels you choose
            here.
          </SheetDescription>
        </SheetHeader>
        <div className="pb-6">
          {isLoading || !teamChannels ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ProjectChannelPicker
              // Remounts with the saved selection each time the sheet opens
              key={selectedIds.join()}
              projectId={projectId}
              channels={teamChannels}
              selectedIds={selectedIds}
              channelSettingsUrl={
                accountSlug
                  ? `/home/${accountSlug}/settings/platforms`
                  : undefined
              }
              onSaved={() => {
                onSaved();
                onOpenChange(false);
              }}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
