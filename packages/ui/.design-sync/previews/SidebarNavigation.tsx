import { Clapperboard, CreditCard, FolderKanban, Home, User } from 'lucide-react';

import { Sidebar, SidebarContent, SidebarNavigation } from '@kit/ui/sidebar';

const config = {
  routes: [
    {
      label: 'Application',
      children: [
        {
          label: 'Overview',
          path: '/home',
          Icon: <Home className="w-4" />,
          end: true,
        },
        {
          label: 'Projects',
          path: '/home/projects',
          Icon: <FolderKanban className="w-4" />,
        },
        {
          label: 'Episodes',
          path: '/home/episodes',
          Icon: <Clapperboard className="w-4" />,
        },
      ],
    },
    { divider: true as const },
    {
      label: 'Settings',
      children: [
        {
          label: 'Profile',
          path: '/home/settings',
          Icon: <User className="w-4" />,
        },
        {
          label: 'Billing',
          path: '/home/billing',
          Icon: <CreditCard className="w-4" />,
        },
      ],
    },
  ],
};

export function Default() {
  return (
    <div className="relative h-[420px] w-full max-w-md overflow-hidden rounded-lg border">
      <Sidebar className="!fixed !h-full !w-full">
        <SidebarContent>
          <SidebarNavigation config={config} />
        </SidebarContent>
      </Sidebar>
    </div>
  );
}
