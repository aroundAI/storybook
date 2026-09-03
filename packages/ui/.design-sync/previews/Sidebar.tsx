import {
  Clapperboard,
  CreditCard,
  FolderKanban,
  Home,
  User,
} from 'lucide-react';

import { Sidebar, SidebarContent, SidebarItem } from '@kit/ui/sidebar';
import { SidebarGroup } from '@kit/ui/sidebar';

// `Sidebar` (makerkit) is the deprecated, pre-shadcn sidebar primitive: it
// manages its own collapsed state internally (no SidebarProvider needed) and
// exposes it via SidebarContext to SidebarItem/SidebarGroup descendants.
export function Default() {
  return (
    <div className="relative h-[420px] w-full max-w-md overflow-hidden rounded-lg border">
      <Sidebar className="!lg:w-[17rem] !fixed !h-full !w-full">
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

export function Collapsed() {
  return (
    <div className="relative h-[420px] w-full max-w-xs overflow-hidden rounded-lg border">
      <Sidebar collapsed className="!fixed !h-full !w-full">
        <SidebarContent>
          <SidebarGroup label="Application" collapsible={false}>
            <SidebarItem path="/home" Icon={<Home className="w-4" />} end>
              Overview
            </SidebarItem>
            <SidebarItem
              path="/home/episodes"
              Icon={<Clapperboard className="w-4" />}
            >
              Episodes
            </SidebarItem>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </div>
  );
}
