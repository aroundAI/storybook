'use client';

import { useState } from 'react';

import { Users } from 'lucide-react';

import { CreateTeamAccountDialog } from '@kit/team-accounts/components';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';

/**
 * Opens the create-team dialog straight away, unless the page has something to
 * say first: a failed platform connect lands here for someone with no team
 * (KB-99), and a modal over that message would hide it.
 */
export function CreateTeamPrompt({
  openOnLoad = true,
}: {
  openOnLoad?: boolean;
}) {
  const [isDialogOpen, setIsDialogOpen] = useState(openOnLoad);

  return (
    <>
      <Card className="mx-auto w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Users className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">Create Your Team</CardTitle>
          <CardDescription>
            Get started by creating your first team. You can invite members and
            manage projects together.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <Button
            size="lg"
            className="w-full"
            onClick={() => setIsDialogOpen(true)}
          >
            Create Team
          </Button>
        </CardContent>
      </Card>

      <CreateTeamAccountDialog
        isOpen={isDialogOpen}
        setIsOpen={setIsDialogOpen}
      />
    </>
  );
}
