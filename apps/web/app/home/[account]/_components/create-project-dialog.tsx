'use client';

import { useState } from 'react';

import { PlusCircle } from 'lucide-react';

import { CreateProjectForm } from '@kit/projects/components';
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

interface CreateProjectDialogProps {
  accountId: string;
}

export function CreateProjectDialog({ accountId }: CreateProjectDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size={'sm'} data-test={'create-project-trigger'}>
          <PlusCircle className={'mr-2 w-4'} />
          <span>
            <Trans i18nKey={'projects:createProject'} />
          </span>
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans i18nKey={'projects:createProject'} />
          </DialogTitle>
          <DialogDescription>
            <Trans i18nKey={'projects:createProjectDescription'} />
          </DialogDescription>
        </DialogHeader>

        <CreateProjectForm
          accountId={accountId}
          onSuccess={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
