import { Plus } from 'lucide-react';

import { Button } from '@kit/ui/button';
import {
  EmptyState,
  EmptyStateButton,
  EmptyStateHeading,
  EmptyStateText,
} from '@kit/ui/empty-state';

export function Default() {
  return (
    <div className="flex h-64">
      <EmptyState>
        <EmptyStateHeading>No teams yet</EmptyStateHeading>
        <EmptyStateText>
          Create a team workspace to start producing episodes together.
        </EmptyStateText>
        <EmptyStateButton asChild>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Create team
          </Button>
        </EmptyStateButton>
      </EmptyState>
    </div>
  );
}

export function NoEpisodes() {
  return (
    <div className="flex h-64">
      <EmptyState>
        <EmptyStateHeading>No episodes yet</EmptyStateHeading>
        <EmptyStateText>
          Start the ideation pipeline to generate your first episode concept for
          this season.
        </EmptyStateText>
        <EmptyStateButton>Start ideation</EmptyStateButton>
      </EmptyState>
    </div>
  );
}
