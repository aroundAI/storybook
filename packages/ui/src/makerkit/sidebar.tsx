import { z } from 'zod';

import { SidebarContext } from './context/sidebar.context';
import type { NavigationConfigSchema } from './navigation-config.schema';

export type SidebarConfig = z.infer<typeof NavigationConfigSchema>;

export { SidebarContext };
