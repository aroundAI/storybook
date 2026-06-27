import { Clapperboard, LayoutDashboard, Music } from 'lucide-react';

import {
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@kit/ui/shadcn-sidebar';

export function Default() {
  return (
    <SidebarProvider>
      <div className="flex h-[240px] w-full max-w-md overflow-hidden rounded-lg border">
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
                <SidebarMenuBadge>12</SidebarMenuBadge>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton>
                  <Music className="h-4 w-4" />
                  <span>Render Queue</span>
                </SidebarMenuButton>
                <SidebarMenuBadge>3</SidebarMenuBadge>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
      </div>
    </SidebarProvider>
  );
}
