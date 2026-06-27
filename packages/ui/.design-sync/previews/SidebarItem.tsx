import { Clapperboard, FolderKanban, Home } from 'lucide-react';

import { Sidebar, SidebarContent, SidebarItem } from '@kit/ui/sidebar';

export function Default() {
  return (
    <div className="relative h-[420px] w-full max-w-md overflow-hidden rounded-lg border">
      <Sidebar className="!fixed !h-full !w-full">
        <SidebarContent>
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
        </SidebarContent>
      </Sidebar>
    </div>
  );
}
