import { FolderOpen } from 'lucide-react';

import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarProvider,
} from '@kit/ui/shadcn-sidebar';

export function Default() {
  return (
    <SidebarProvider>
      <div className="flex h-[200px] w-full max-w-md overflow-hidden rounded-lg border">
        <Sidebar collapsible="none">
          <SidebarHeader className="h-14 justify-center border-b px-3">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted">
                <FolderOpen className="h-4 w-4 text-muted-foreground" />
              </div>
              <span className="text-sm font-semibold">Lumen Pictures</span>
            </div>
          </SidebarHeader>
          <SidebarContent className="p-2">
            <p className="p-2 text-xs text-muted-foreground">
              Sidebar content below the header
            </p>
          </SidebarContent>
        </Sidebar>
      </div>
    </SidebarProvider>
  );
}
