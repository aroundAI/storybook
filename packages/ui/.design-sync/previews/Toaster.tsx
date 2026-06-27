'use client';

import { Button } from '@kit/ui/button';
import { Toaster, toast } from '@kit/ui/sonner';

export function Default() {
  return (
    <div className="flex flex-col gap-3">
      <Button
        variant="outline"
        onClick={() => toast.success('Episode rendered successfully')}
      >
        Trigger success toast
      </Button>
      <Toaster />
    </div>
  );
}

export function Variants() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          onClick={() => toast.success('Shot list saved')}
        >
          Success
        </Button>
        <Button
          variant="outline"
          onClick={() => toast.error('Voice cloning failed — quota exceeded')}
        >
          Error
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            toast.promise(new Promise((resolve) => setTimeout(resolve, 2000)), {
              loading: 'Generating screenplay...',
              success: 'Screenplay ready!',
              error: 'Generation failed',
            })
          }
        >
          Promise
        </Button>
      </div>
      <Toaster />
    </div>
  );
}
