import { z } from 'zod';

import { NavigationConfigSchema } from '@kit/ui/navigation-schema';
import { SidebarNavigation } from '@kit/ui/shadcn-sidebar';

export function TeamAccountLayoutSidebarNavigation({
  config,
}: React.PropsWithChildren<{
  config: z.infer<typeof NavigationConfigSchema>;
}>) {
  return <SidebarNavigation config={config} />;
}
