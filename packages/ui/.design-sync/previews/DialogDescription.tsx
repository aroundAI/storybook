import { Trash2 } from 'lucide-react';

import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@kit/ui/dialog';

export function Default() {
  return (
    <Dialog open={true} onOpenChange={() => {}}>
      <DialogTrigger asChild>
        <Button variant="destructive">Unpublish episode</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-red-500" />
            Confirm Unpublish
          </DialogTitle>
          <DialogDescription>
            This will remove &quot;S2E04 — The Lighthouse Keeper&apos;s
            Secret&quot; from YouTube and TikTok and clear its publish history.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline">Cancel</Button>
          <Button variant="destructive">
            <Trash2 className="mr-2 h-4 w-4" />
            Unpublish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FormDialog() {
  return (
    <Dialog open={true} onOpenChange={() => {}}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add narrative event</DialogTitle>
          <DialogDescription>
            Record an immutable event in the season&apos;s canon timeline.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Event title</label>
            <div className="text-muted-foreground rounded-md border px-3 py-2 text-sm">
              Mara discovers the ledger
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Event type</label>
            <div className="text-muted-foreground rounded-md border px-3 py-2 text-sm">
              Reveal
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline">Cancel</Button>
          <Button>Save event</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
