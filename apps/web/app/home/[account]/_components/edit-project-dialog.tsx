'use client';

import { useState } from 'react';

import { PencilIcon } from 'lucide-react';

import { UpdateProjectForm } from '@kit/projects/components/update-project-form';
import type { Project } from '@kit/projects/types';
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

interface EditProjectDialogProps {
  project: Project;
}

export function EditProjectDialog({ project }: EditProjectDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <PencilIcon className="mr-2 h-4 w-4" />
          <Trans i18nKey={'common:edit'} />
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans i18nKey={'projects:editProject'} />
          </DialogTitle>
          <DialogDescription>
            <Trans i18nKey={'projects:editProjectDescription'} />
          </DialogDescription>
        </DialogHeader>

        <UpdateProjectForm project={project} onSuccess={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
