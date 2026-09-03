import {
  Clapperboard,
  LayoutDashboard,
  Music,
  Settings,
  Users,
} from 'lucide-react';

import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarNavigation,
  SidebarProvider,
} from '@kit/ui/shadcn-sidebar';

const config = {
  style: 'sidebar' as const,
  sidebarCollapsed: false,
  sidebarCollapsedStyle: 'icon' as const,
  routes: [
    {
      label: 'Application',
      children: [
        {
          label: 'Overview',
          path: '/home/lumen-pictures/studio',
          Icon: <LayoutDashboard className="h-4 w-4" />,
          end: true,
        },
        {
          label: 'Episodes',
          path: '/home/lumen-pictures/studio/episodes',
          Icon: <Clapperboard className="h-4 w-4" />,
        },
      ],
    },
    {
      label: 'Assets',
      children: [
        {
          label: 'Characters',
          path: '/home/lumen-pictures/studio/assets?tab=character',
          Icon: <Users className="h-4 w-4" />,
        },
        {
          label: 'Audio Library',
          path: '/home/lumen-pictures/studio/audio-library',
          Icon: <Music className="h-4 w-4" />,
        },
      ],
    },
    {
      label: 'Workspace',
      children: [
        {
          label: 'Settings',
          path: '/home/lumen-pictures/studio/settings',
          Icon: <Settings className="h-4 w-4" />,
        },
      ],
    },
  ],
};

export function Default() {
  return (
    <SidebarProvider>
      <div className="flex h-[420px] w-full max-w-md overflow-hidden rounded-lg border">
        <Sidebar collapsible="none">
          <SidebarHeader className="h-14 justify-center border-b px-3">
            <span className="text-sm font-semibold">Lumen Pictures</span>
          </SidebarHeader>
          <SidebarContent className="p-2">
            <SidebarNavigation config={config} />
          </SidebarContent>
        </Sidebar>

        <div className="bg-background flex-1 p-4">
          <p className="text-muted-foreground text-sm">Main content area</p>
        </div>
      </div>
    </SidebarProvider>
  );
}
