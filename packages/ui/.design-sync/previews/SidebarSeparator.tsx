import { Clapperboard, CreditCard, LayoutDashboard, User } from 'lucide-react';

import {
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
} from '@kit/ui/shadcn-sidebar';

export function Default() {
  return (
    <SidebarProvider>
      <div className="flex h-[320px] w-full max-w-md overflow-hidden rounded-lg border">
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
            </SidebarMenu>

            <SidebarSeparator className="my-2" />

            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton>
                  <User className="h-4 w-4" />
                  <span>Profile</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton>
                  <CreditCard className="h-4 w-4" />
                  <span>Billing</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
      </div>
    </SidebarProvider>
  );
}
