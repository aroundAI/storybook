import { Clapperboard, LayoutDashboard, Music, Users } from 'lucide-react';

import {
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@kit/ui/shadcn-sidebar';

export function Default() {
  return (
    <SidebarProvider>
      <div className="flex h-[280px] w-full max-w-md overflow-hidden rounded-lg border">
        <Sidebar collapsible="none">
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
      </div>
    </SidebarProvider>
  );
}
