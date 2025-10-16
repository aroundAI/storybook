'use client';

import { useState } from 'react';

import { UserPlusIcon } from 'lucide-react';

import { AddProjectMemberForm } from '@kit/projects/components/add-project-member-form';
import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@kit/ui/dialog';
import { Trans } from '@kit/ui/trans';

interface AccountMember {
  user_id: string;
  user_name: string | null;
  user_email: string | null;
}

interface AddProjectMemberDialogProps {
  projectId: string;
  availableMembers: AccountMember[];
}

export function AddProjectMemberDialog({
  projectId,
  availableMembers,
}: AddProjectMemberDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlusIcon className="mr-2 h-4 w-4" />
          <Trans i18nKey={'projects:addMember'} />
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans i18nKey={'projects:addMember'} />
          </DialogTitle>
          <DialogDescription>
            <Trans i18nKey={'projects:addMemberDescription'} />
          </DialogDescription>
        </DialogHeader>

        <AddProjectMemberForm
          projectId={projectId}
          availableMembers={availableMembers}
          onSuccess={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
