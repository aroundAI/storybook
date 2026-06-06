'use client';

import { useState } from 'react';

import { Sparkles } from 'lucide-react';

import { Button } from '@kit/ui/button';

import { CreateEpisodeWizard } from './create-episode-wizard';

interface Season {
  id: string;
  name: string;
  number: number;
}

interface CreateEpisodeWizardWrapperProps {
  projectId: string;
  projectSlug: string;
  account: string;
  seasons: Season[];
}

export function CreateEpisodeWizardWrapper({
  projectId,
  projectSlug,
  account,
  seasons,
}: CreateEpisodeWizardWrapperProps) {
  const [wizardOpen, setWizardOpen] = useState(false);

  return (
    <>
      <Button variant="outline" onClick={() => setWizardOpen(true)}>
        <Sparkles className="mr-2 h-4 w-4" />
        Advanced
      </Button>

      <CreateEpisodeWizard
        projectId={projectId}
        projectSlug={projectSlug}
        account={account}
        seasons={seasons}
        open={wizardOpen}
        onOpenChange={setWizardOpen}
      />
    </>
  );
}
