import { ArrowLeft, ChevronDown, FolderOpen } from 'lucide-react';

import { Button } from '@kit/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@kit/ui/sheet';

export function Default() {
  return (
    <Sheet open>
      <SheetTrigger asChild>
        <Button variant="outline">Open project switcher</Button>
      </SheetTrigger>
      <SheetContent side="left" className="bg-sidebar w-[280px] p-0">
        <div className="flex h-full flex-col">
          <div className="flex flex-col gap-2 border-b p-3">
            <span className="text-sidebar-foreground flex items-center text-sm">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Projects
            </span>
            <div className="hover:bg-sidebar-accent flex w-full items-center justify-between rounded-md p-2">
              <div className="flex items-center gap-2">
                <div className="bg-muted flex h-8 w-8 items-center justify-center rounded-md">
                  <FolderOpen className="text-muted-foreground h-4 w-4" />
                </div>
                <div className="text-left">
                  <h2 className="text-sidebar-foreground max-w-[140px] truncate text-sm leading-tight font-semibold">
                    Lumen Pictures
                  </h2>
                  <p className="text-muted-foreground text-xs">
                    Switch Project
                  </p>
                </div>
              </div>
              <ChevronDown className="text-muted-foreground h-4 w-4 shrink-0" />
            </div>
          </div>
          <div className="flex-1 space-y-1 overflow-y-auto p-3 text-sm">
            <p className="text-muted-foreground px-2 text-xs font-medium tracking-wide uppercase">
              Application
            </p>
            <p className="rounded-md p-2">Overview</p>
            <p className="rounded-md p-2">Episodes</p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function ConfirmSheet() {
  return (
    <Sheet open>
      <SheetTrigger asChild>
        <Button variant="destructive">Delete episode</Button>
      </SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Delete this episode?</SheetTitle>
          <SheetDescription>
            This will permanently remove &quot;The Hollow Light&quot; and all
            associated shots, dialogue, and rendered assets.
          </SheetDescription>
        </SheetHeader>
        <SheetFooter>
          <Button variant="outline">Cancel</Button>
          <Button variant="destructive">Delete episode</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
