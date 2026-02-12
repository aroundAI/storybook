'use client';

/**
 * StudioSidebar Component
 *
 * Custom sidebar for project-level routes based on the prototype design.
 * Supports light and dark modes with a refined grayscale palette.
 * Can be collapsed to icon-only mode for more workspace.
 */
import { useEffect, useState } from 'react';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  FolderOpen,
  LayoutDashboard,
  MapPin,
  Music,
  Search,
  Settings,
  Share2,
  Users,
} from 'lucide-react';

import { JWTUserData } from '@kit/supabase/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';
import { Input } from '@kit/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@kit/ui/tooltip';
import { cn } from '@kit/ui/utils';

import { ProfileAccountDropdownContainer } from '~/components/personal-account-dropdown-container';

const SIDEBAR_COLLAPSED_KEY = 'studio-sidebar-collapsed';

interface Project {
  id: string;
  name: string;
  slug: string | null;
}

interface StudioSidebarProps {
  project: Project;
  account: string;
  recentProjects?: Array<{
    id: string;
    name: string;
    slug: string | null;
    updated_at?: string;
  }>;
  user: JWTUserData;
  counts?: {
    episodes?: number;
    characters?: number;
    locations?: number;
    researchSources?: number;
    researchFacts?: number;
  };
}

interface NavItemProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  count?: number;
  isActive?: boolean;
  isCollapsed?: boolean;
}

function NavItem({
  href,
  icon,
  label,
  count,
  isActive,
  isCollapsed,
}: NavItemProps) {
  const content = (
    <Link
      href={href}
      className={cn(
        'flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm transition-colors',
        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        isActive
          ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
          : 'text-sidebar-foreground',
        isCollapsed && 'justify-center',
      )}
    >
      <span className="h-4 w-4 shrink-0">{icon}</span>
      {!isCollapsed && (
        <>
          <span className="truncate">{label}</span>
          {count !== undefined && (
            <span className="ml-auto text-xs tabular-nums">{count}</span>
          )}
        </>
      )}
    </Link>
  );

  if (isCollapsed) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="right" className="flex items-center gap-2">
          {label}
          {count !== undefined && (
            <span className="text-muted-foreground text-xs">({count})</span>
          )}
        </TooltipContent>
      </Tooltip>
    );
  }

  return content;
}

function SectionHeader({
  children,
  isCollapsed,
}: {
  children: React.ReactNode;
  isCollapsed?: boolean;
}) {
  if (isCollapsed) return null;
  return (
    <h3 className="text-muted-foreground mb-1 px-2 text-xs font-medium">
      {children}
    </h3>
  );
}

export function StudioSidebar({
  project,
  account,
  recentProjects = [],
  user,
  counts = {},
}: StudioSidebarProps) {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [isProjectSwitcherOpen, setIsProjectSwitcherOpen] = useState(false);

  // Collapsed state with localStorage persistence
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Load collapsed state from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    if (stored === 'true') {
      setIsCollapsed(true);
    }
  }, []);

  // Persist collapsed state to localStorage
  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(isCollapsed));
  }, [isCollapsed]);

  const basePath = `/home/${account}/studio/${project.slug ?? project.id}`;

  // Check if a path is active
  const isActive = (path: string, exact = false) => {
    if (exact) {
      return pathname === path;
    }
    return pathname.startsWith(path);
  };

  // Filter projects by search
  const filteredProjects = recentProjects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()),
  );

  // Navigate to a project
  const navigateToProject = (projectSlug: string) => {
    setIsProjectSwitcherOpen(false);
    router.push(`/home/${account}/studio/${projectSlug}`);
  };

  return (
    <TooltipProvider>
      <aside
        className={cn(
          'bg-sidebar flex h-screen shrink-0 flex-col border-r transition-all duration-300',
          isCollapsed ? 'w-[60px]' : 'w-[225px]',
        )}
      >
        {/* Header */}
        <div className="flex flex-col gap-2 p-2">
          {/* Back to Projects */}
          {isCollapsed ? (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Link
                  href={`/home/${account}/studio`}
                  className="hover:bg-sidebar-accent flex items-center justify-center rounded-md p-2 transition-colors"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">Projects</TooltipContent>
            </Tooltip>
          ) : (
            <div className="px-1 pt-2 pb-1">
              <Link
                href={`/home/${account}/studio`}
                className="text-sidebar-foreground hover:text-sidebar-accent-foreground flex items-center text-sm transition-colors"
              >
                <ArrowLeft className="mr-1 h-4 w-4" />
                Projects
              </Link>
            </div>
          )}

          {/* Project Switcher */}
          {isCollapsed ? (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <DropdownMenu
                  open={isProjectSwitcherOpen}
                  onOpenChange={setIsProjectSwitcherOpen}
                >
                  <DropdownMenuTrigger asChild>
                    <button className="hover:bg-sidebar-accent flex items-center justify-center rounded-md p-2 transition-colors">
                      <div className="bg-muted flex h-8 w-8 items-center justify-center rounded-md">
                        <FolderOpen className="text-muted-foreground h-4 w-4" />
                      </div>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    className="w-56"
                    align="start"
                    side="right"
                    sideOffset={8}
                  >
                    {/* Search */}
                    <div className="p-2">
                      <div className="relative">
                        <Search className="text-muted-foreground absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2" />
                        <Input
                          placeholder="Search projects..."
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          className="h-8 pl-8 text-sm"
                        />
                      </div>
                    </div>

                    <DropdownMenuSeparator />

                    {/* All Projects List */}
                    <div className="max-h-[300px] overflow-y-auto">
                      {filteredProjects.length > 0 ? (
                        filteredProjects.map((p) => (
                          <DropdownMenuItem
                            key={p.id}
                            onClick={() =>
                              p.id !== project.id &&
                              navigateToProject(p.slug ?? p.id)
                            }
                            className={
                              p.id === project.id
                                ? 'bg-muted'
                                : 'cursor-pointer'
                            }
                          >
                            <FolderOpen className="text-muted-foreground mr-2 h-4 w-4" />
                            <span className="flex-1 truncate">{p.name}</span>
                            {p.id === project.id && (
                              <Check className="text-primary ml-2 h-4 w-4" />
                            )}
                          </DropdownMenuItem>
                        ))
                      ) : (
                        <div className="text-muted-foreground px-2 py-4 text-center text-sm">
                          {search ? 'No projects found' : 'No projects'}
                        </div>
                      )}
                    </div>

                    <DropdownMenuSeparator />

                    {/* View All Projects */}
                    <DropdownMenuItem asChild>
                      <Link
                        href={`/home/${account}/studio`}
                        className="text-primary flex items-center justify-center font-medium"
                      >
                        View All Projects
                      </Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TooltipTrigger>
              <TooltipContent side="right">{project.name}</TooltipContent>
            </Tooltip>
          ) : (
            <DropdownMenu
              open={isProjectSwitcherOpen}
              onOpenChange={setIsProjectSwitcherOpen}
            >
              <DropdownMenuTrigger asChild>
                <button className="group hover:bg-sidebar-accent flex w-full items-center justify-between rounded-md p-2 transition-colors">
                  <div className="flex items-center gap-2">
                    <div className="bg-muted flex h-8 w-8 items-center justify-center rounded-md">
                      <FolderOpen className="text-muted-foreground h-4 w-4" />
                    </div>
                    <div className="text-left">
                      <h2 className="text-sidebar-foreground max-w-[120px] truncate text-sm leading-tight font-semibold">
                        {project.name}
                      </h2>
                      <p className="text-muted-foreground text-xs">
                        Switch Project
                      </p>
                    </div>
                  </div>
                  <ChevronDown
                    className={cn(
                      'text-muted-foreground h-4 w-4 shrink-0 transition-transform',
                      isProjectSwitcherOpen && 'rotate-180',
                    )}
                  />
                </button>
              </DropdownMenuTrigger>

              <DropdownMenuContent
                className="w-56"
                align="start"
                sideOffset={8}
              >
                {/* Search */}
                <div className="p-2">
                  <div className="relative">
                    <Search className="text-muted-foreground absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2" />
                    <Input
                      placeholder="Search projects..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="h-8 pl-8 text-sm"
                    />
                  </div>
                </div>

                <DropdownMenuSeparator />

                {/* All Projects List */}
                <div className="max-h-[300px] overflow-y-auto">
                  {filteredProjects.length > 0 ? (
                    filteredProjects.map((p) => (
                      <DropdownMenuItem
                        key={p.id}
                        onClick={() =>
                          p.id !== project.id &&
                          navigateToProject(p.slug ?? p.id)
                        }
                        className={
                          p.id === project.id ? 'bg-muted' : 'cursor-pointer'
                        }
                      >
                        <FolderOpen className="text-muted-foreground mr-2 h-4 w-4" />
                        <span className="flex-1 truncate">{p.name}</span>
                        {p.id === project.id && (
                          <Check className="text-primary ml-2 h-4 w-4" />
                        )}
                      </DropdownMenuItem>
                    ))
                  ) : (
                    <div className="text-muted-foreground px-2 py-4 text-center text-sm">
                      {search ? 'No projects found' : 'No projects'}
                    </div>
                  )}
                </div>

                <DropdownMenuSeparator />

                {/* View All Projects */}
                <DropdownMenuItem asChild>
                  <Link
                    href={`/home/${account}/studio`}
                    className="text-primary flex items-center justify-center font-medium"
                  >
                    View All Projects
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Navigation Content */}
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2">
          {/* Application Section */}
          <div>
            <SectionHeader isCollapsed={isCollapsed}>Application</SectionHeader>
            <nav className="space-y-0.5">
              <NavItem
                href={basePath}
                icon={<LayoutDashboard className="h-4 w-4" />}
                label="Overview"
                isActive={isActive(basePath, true)}
                isCollapsed={isCollapsed}
              />
              <NavItem
                href={`${basePath}/episodes`}
                icon={<Clapperboard className="h-4 w-4" />}
                label="Episodes"
                count={counts.episodes}
                isActive={isActive(`${basePath}/episodes`)}
                isCollapsed={isCollapsed}
              />
            </nav>
          </div>

          {/* Assets Section */}
          <div>
            <SectionHeader isCollapsed={isCollapsed}>Assets</SectionHeader>
            <nav className="space-y-0.5">
              <NavItem
                href={`${basePath}/assets?tab=character`}
                icon={<Users className="h-4 w-4" />}
                label="Characters"
                count={counts.characters}
                isActive={
                  pathname.includes('/assets') && pathname.includes('character')
                }
                isCollapsed={isCollapsed}
              />
              <NavItem
                href={`${basePath}/assets?tab=location`}
                icon={<MapPin className="h-4 w-4" />}
                label="Locations"
                count={counts.locations}
                isActive={
                  pathname.includes('/assets') && pathname.includes('location')
                }
                isCollapsed={isCollapsed}
              />
              <NavItem
                href={`${basePath}/audio-library`}
                icon={<Music className="h-4 w-4" />}
                label="Audio Library"
                isActive={pathname.includes('/audio-library')}
                isCollapsed={isCollapsed}
              />
            </nav>
          </div>

          {/* Research Section */}
          <div>
            <SectionHeader isCollapsed={isCollapsed}>Research</SectionHeader>
            <nav className="space-y-0.5">
              <NavItem
                href={`${basePath}/research`}
                icon={<BookOpen className="h-4 w-4" />}
                label="Research Hub"
                count={
                  ((counts.researchSources ?? 0) + (counts.researchFacts ?? 0)) ||
                  undefined
                }
                isActive={isActive(`${basePath}/research`)}
                isCollapsed={isCollapsed}
              />
            </nav>
          </div>

          {/* Settings Section */}
          <div>
            <SectionHeader isCollapsed={isCollapsed}>Settings</SectionHeader>
            <nav className="space-y-0.5">
              <NavItem
                href={`${basePath}/analytics`}
                icon={<BarChart3 className="h-4 w-4" />}
                label="Analytics"
                isActive={isActive(`${basePath}/analytics`)}
                isCollapsed={isCollapsed}
              />
              <NavItem
                href={`${basePath}/platforms`}
                icon={<Share2 className="h-4 w-4" />}
                label="Platforms"
                isActive={isActive(`${basePath}/platforms`)}
                isCollapsed={isCollapsed}
              />
              <NavItem
                href={`${basePath}/settings`}
                icon={<Settings className="h-4 w-4" />}
                label="Project Settings"
                isActive={isActive(`${basePath}/settings`)}
                isCollapsed={isCollapsed}
              />
            </nav>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-2 border-t p-2">
          {/* Collapse Toggle */}
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="hover:bg-sidebar-accent text-muted-foreground hover:text-sidebar-accent-foreground flex items-center justify-center rounded-md p-2 transition-colors"
                aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                {isCollapsed ? (
                  <ChevronRight className="h-4 w-4" />
                ) : (
                  <ChevronLeft className="h-4 w-4" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            </TooltipContent>
          </Tooltip>

          {/* User Profile - only show when expanded */}
          {!isCollapsed && <ProfileAccountDropdownContainer user={user} />}
        </div>
      </aside>
    </TooltipProvider>
  );
}
