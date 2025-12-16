import {
  BarChart3,
  Clapperboard,
  Film,
  FolderOpen,
  MapPin,
  Music,
  Users,
} from 'lucide-react';

import { NavigationConfigSchema } from '@kit/ui/navigation-schema';

const iconClasses = 'w-4';

/**
 * Get project-level navigation routes for the studio sidebar.
 * Used when inside a specific project (/studio/[projectId]).
 */
function getProjectRoutes(accountSlug: string, projectId: string) {
  const basePath = `/home/${accountSlug}/studio/${projectId}`;

  return [
    {
      label: 'studio:routes.production',
      children: [
        {
          label: 'studio:routes.overview',
          path: basePath,
          Icon: <FolderOpen className={iconClasses} />,
          end: true,
        },
        {
          label: 'studio:routes.episodes',
          path: `${basePath}/episodes`,
          Icon: <Clapperboard className={iconClasses} />,
        },
      ],
    },
    {
      label: 'studio:routes.assets',
      children: [
        {
          label: 'studio:routes.characters',
          path: `${basePath}/assets?tab=character`,
          Icon: <Users className={iconClasses} />,
        },
        {
          label: 'studio:routes.locations',
          path: `${basePath}/assets?tab=location`,
          Icon: <MapPin className={iconClasses} />,
        },
        {
          label: 'studio:routes.voices',
          path: `${basePath}/assets?tab=voice`,
          Icon: <Music className={iconClasses} />,
        },
      ],
    },
    {
      label: 'common:routes.settings',
      children: [
        {
          label: 'studio:routes.analytics',
          path: `${basePath}/analytics`,
          Icon: <BarChart3 className={iconClasses} />,
        },
      ],
    },
  ];
}

/**
 * Get account-level navigation routes for the studio home.
 * Used at the studio root level (/studio) to show all projects.
 */
function getStudioHomeRoutes(accountSlug: string) {
  const basePath = `/home/${accountSlug}/studio`;

  return [
    {
      label: 'studio:routes.application',
      children: [
        {
          label: 'studio:routes.allProjects',
          path: basePath,
          Icon: <Film className={iconClasses} />,
          end: true,
        },
      ],
    },
  ];
}

/**
 * Get studio navigation configuration based on context.
 *
 * @param params.accountSlug - The account slug for URL building
 * @param params.projectId - Optional project ID. If provided, returns project-level nav
 * @returns NavigationConfigSchema-compliant configuration
 */
export function getStudioNavigationConfig(params: {
  accountSlug: string;
  projectId?: string;
}) {
  const { accountSlug, projectId } = params;

  const routes = projectId
    ? getProjectRoutes(accountSlug, projectId)
    : getStudioHomeRoutes(accountSlug);

  return NavigationConfigSchema.parse({
    routes,
    ...(process.env.NEXT_PUBLIC_TEAM_NAVIGATION_STYLE && {
      style: process.env.NEXT_PUBLIC_TEAM_NAVIGATION_STYLE,
    }),
    ...(process.env.NEXT_PUBLIC_TEAM_SIDEBAR_COLLAPSED && {
      sidebarCollapsed: process.env.NEXT_PUBLIC_TEAM_SIDEBAR_COLLAPSED,
    }),
    ...(process.env.NEXT_PUBLIC_SIDEBAR_COLLAPSIBLE_STYLE && {
      sidebarCollapsedStyle: process.env.NEXT_PUBLIC_SIDEBAR_COLLAPSIBLE_STYLE,
    }),
  });
}
