import { Clapperboard, CreditCard, FolderKanban, Home, User } from 'lucide-react';

import { Sidebar, SidebarContent, SidebarGroup, SidebarItem } from '@kit/ui/sidebar';

export function Default() {
  return (
    <div className="relative h-[420px] w-full max-w-md overflow-hidden rounded-lg border">
      <Sidebar className="!fixed !h-full !w-full">
        <SidebarContent>
          <SidebarGroup label="Application" collapsible={false}>
            <SidebarItem path="/home" Icon={<Home className="w-4" />} end>
              Overview
            </SidebarItem>
            <SidebarItem
              path="/home/projects"
              Icon={<FolderKanban className="w-4" />}
            >
              Projects
            </SidebarItem>
            <SidebarItem
              path="/home/episodes"
              Icon={<Clapperboard className="w-4" />}
            >
              Episodes
            </SidebarItem>
          </SidebarGroup>

          <SidebarGroup label="Settings" collapsible={false}>
            <SidebarItem path="/home/settings" Icon={<User className="w-4" />}>
              Profile
            </SidebarItem>
            <SidebarItem
              path="/home/billing"
              Icon={<CreditCard className="w-4" />}
            >
              Billing
            </SidebarItem>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </div>
  );
}

export function Collapsible() {
  return (
    <div className="relative h-[420px] w-full max-w-md overflow-hidden rounded-lg border">
      <Sidebar className="!fixed !h-full !w-full">
        <SidebarContent>
          <SidebarGroup label="Advanced" collapsible collapsed={false}>
            <SidebarItem path="/home/api-keys" Icon={<CreditCard className="w-4" />}>
              API Keys
            </SidebarItem>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </div>
  );
}
