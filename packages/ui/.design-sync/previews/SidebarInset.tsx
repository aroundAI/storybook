import {
  Clapperboard,
  FolderOpen,
  LayoutDashboard,
  Music,
  Users,
} from 'lucide-react';

import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@kit/ui/shadcn-sidebar';

export function Default() {
  return (
    <SidebarProvider>
      <div className="flex h-[420px] w-full max-w-md overflow-hidden rounded-lg border">
        <Sidebar collapsible="none">
          <SidebarHeader className="h-14 justify-center border-b px-3">
            <div className="flex items-center gap-2">
              <div className="bg-muted flex h-7 w-7 items-center justify-center rounded-md">
                <FolderOpen className="text-muted-foreground h-4 w-4" />
              </div>
              <span className="text-sm font-semibold">Lumen Pictures</span>
            </div>
          </SidebarHeader>

          <SidebarContent className="p-2">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive>
                  <LayoutDashboard className="h-4 w-4" />
                  <span>Overview</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton>
                  <Clapperboard className="h-4 w-4" />
                  <span>Episodes</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton>
                  <Users className="h-4 w-4" />
                  <span>Characters</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton>
                  <Music className="h-4 w-4" />
                  <span>Audio Library</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>

        <SidebarInset className="p-4">
          <div className="mb-3 flex items-center gap-2 border-b pb-3">
            <SidebarTrigger />
            <span className="text-sm font-medium">Episodes</span>
          </div>
          <p className="text-muted-foreground text-sm">
            SidebarInset wraps the main content area so it sits flush next to
            the sidebar with matching rounded corners and background.
          </p>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
