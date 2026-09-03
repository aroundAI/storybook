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
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
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
              <div className="bg-muted flex h-7 w-7 items-center justify-center rounded-md">
                <FolderOpen className="text-muted-foreground h-4 w-4" />
              </div>
              <span className="text-sm font-semibold">Lumen Pictures</span>
            </div>
          </SidebarHeader>

          <SidebarContent className="p-2">
            <SidebarGroup>
              <SidebarGroupLabel>Application</SidebarGroupLabel>
              <SidebarGroupContent>
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
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>Assets</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
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
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter className="border-t p-2 text-xs">
            <div className="flex items-center gap-2 p-1">
              <div className="bg-muted flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium">
                S
              </div>
              <span className="text-muted-foreground">shaurya@example.com</span>
            </div>
          </SidebarFooter>
        </Sidebar>

        <div className="bg-background flex-1 p-4">
          <p className="text-muted-foreground text-sm">Main content area</p>
        </div>
      </div>
    </SidebarProvider>
  );
}
