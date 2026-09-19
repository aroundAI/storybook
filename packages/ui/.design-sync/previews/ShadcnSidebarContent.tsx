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
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@kit/ui/shadcn-sidebar';

export function Default() {
  return (
    <SidebarProvider>
      <div className="flex h-[420px] w-full max-w-md overflow-hidden rounded-lg border">
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

          <SidebarFooter className="border-t p-2 text-xs">
            <div className="flex items-center gap-2 p-1">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-medium">
                S
              </div>
              <span className="text-muted-foreground">shaurya@example.com</span>
            </div>
          </SidebarFooter>
        </Sidebar>

        <div className="flex-1 bg-background p-4">
          <p className="text-sm text-muted-foreground">Main content area</p>
        </div>
      </div>
    </SidebarProvider>
  );
}
