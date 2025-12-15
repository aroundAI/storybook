'use client';

/**
 * StudioSidebar Component
 * 
 * Custom sidebar for project-level routes based on the prototype design.
 * Supports light and dark modes with a refined grayscale palette.
 */

import { useState } from 'react';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import {
  ArrowLeft,
  BarChart3,
  Check,
  ChevronDown,
  Clapperboard,
  FolderOpen,
  LayoutDashboard,
  MapPin,
  Search,
  Settings,
  Users,
  AudioLines,
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
import { cn } from '@kit/ui/utils';

import { ProfileAccountDropdownContainer } from '~/components/personal-account-dropdown-container';

interface Project {
  id: string;
  name: string;
}

interface StudioSidebarProps {
  project: Project;
  account: string;
  recentProjects?: Array<{ id: string; name: string; updated_at?: string }>;
  user: JWTUserData;
  counts?: {
    episodes?: number;
    characters?: number;
    locations?: number;
  };
}

interface NavItemProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  count?: number;
  isActive?: boolean;
}

function NavItem({ href, icon, label, count, isActive }: NavItemProps) {
  return (
    <Link
      href={href}
      className={cn(
        'flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm transition-colors',
        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        isActive
          ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
          : 'text-sidebar-foreground'
      )}
    >
      <span className="w-4 h-4 shrink-0">
        {icon}
      </span>
      <span className="truncate">{label}</span>
      {count !== undefined && (
        <span className="ml-auto text-xs tabular-nums">
          {count}
        </span>
      )}
    </Link>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="px-2 mb-1 text-xs font-medium text-muted-foreground">
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
  const pathname = usePathname();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [isProjectSwitcherOpen, setIsProjectSwitcherOpen] = useState(false);

  const basePath = `/home/${account}/studio/${project.id}`;

  // Check if a path is active
  const isActive = (path: string, exact = false) => {
    if (exact) {
      return pathname === path;
    }
    return pathname.startsWith(path);
  };

  // Filter projects by search
  const filteredProjects = recentProjects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  // Navigate to a project
  const navigateToProject = (projectId: string) => {
    setIsProjectSwitcherOpen(false);
    router.push(`/home/${account}/studio/${projectId}`);
  };

  return (
    <aside className="flex h-screen w-[225px] flex-col bg-sidebar border-r shrink-0">
      {/* Header */}
      <div className="flex flex-col gap-2 p-2">
        {/* Back to Projects */}
        <div className="px-1 pt-2 pb-1">
          <Link
            href={`/home/${account}/studio`}
            className="flex items-center text-sm text-sidebar-foreground hover:text-sidebar-accent-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Projects
          </Link>
        </div>

        {/* Project Switcher */}
        <DropdownMenu open={isProjectSwitcherOpen} onOpenChange={setIsProjectSwitcherOpen}>
          <DropdownMenuTrigger asChild>
            <button className="w-full flex items-center justify-between group p-2 rounded-md hover:bg-sidebar-accent transition-colors">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center">
                  <FolderOpen className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="text-left">
                  <h2 className="font-semibold text-sm text-sidebar-foreground leading-tight truncate max-w-[120px]">
                    {project.name}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Switch Project
                  </p>
                </div>
              </div>
              <ChevronDown className={cn(
                'w-4 h-4 text-muted-foreground transition-transform shrink-0',
                isProjectSwitcherOpen && 'rotate-180'
              )} />
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
                <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
                    onClick={() => p.id !== project.id && navigateToProject(p.id)}
                    className={p.id === project.id ? 'bg-muted' : 'cursor-pointer'}
                  >
                    <FolderOpen className="mr-2 h-4 w-4 text-muted-foreground" />
                    <span className="truncate flex-1">{p.name}</span>
                    {p.id === project.id && (
                      <Check className="h-4 w-4 text-primary ml-2" />
                    )}
                  </DropdownMenuItem>
                ))
              ) : (
                <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                  {search ? 'No projects found' : 'No projects'}
                </div>
              )}
            </div>

            <DropdownMenuSeparator />

            {/* View All Projects */}
            <DropdownMenuItem asChild>
              <Link
                href={`/home/${account}/studio`}
                className="flex items-center justify-center font-medium text-primary"
              >
                View All Projects
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Navigation Content */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2">
        {/* Application Section */}
        <div>
          <SectionHeader>Application</SectionHeader>
          <nav className="space-y-0.5">
            <NavItem
              href={basePath}
              icon={<LayoutDashboard className="w-4 h-4" />}
              label="Overview"
              isActive={isActive(basePath, true)}
            />
            <NavItem
              href={`${basePath}/episodes`}
              icon={<Clapperboard className="w-4 h-4" />}
              label="Episodes"
              count={counts.episodes}
              isActive={isActive(`${basePath}/episodes`)}
            />
          </nav>
        </div>

        {/* Assets Section */}
        <div>
          <SectionHeader>Assets</SectionHeader>
          <nav className="space-y-0.5">
            <NavItem
              href={`${basePath}/assets?tab=character`}
              icon={<Users className="w-4 h-4" />}
              label="Characters"
              count={counts.characters}
              isActive={pathname.includes('/assets') && pathname.includes('character')}
            />
            <NavItem
              href={`${basePath}/assets?tab=location`}
              icon={<MapPin className="w-4 h-4" />}
              label="Locations"
              count={counts.locations}
              isActive={pathname.includes('/assets') && pathname.includes('location')}
            />
            <NavItem
              href={`${basePath}/assets?tab=voice`}
              icon={<AudioLines className="w-4 h-4" />}
              label="Voices"
              isActive={pathname.includes('/assets') && pathname.includes('voice')}
            />
          </nav>
        </div>

        {/* Settings Section */}
        <div>
          <SectionHeader>Settings</SectionHeader>
          <nav className="space-y-0.5">
            <NavItem
              href={`${basePath}/analytics`}
              icon={<BarChart3 className="w-4 h-4" />}
              label="Analytics"
              isActive={isActive(`${basePath}/analytics`)}
            />
            <NavItem
              href={`${basePath}/settings`}
              icon={<Settings className="w-4 h-4" />}
              label="Project Settings"
              isActive={isActive(`${basePath}/settings`)}
            />
          </nav>
        </div>
      </div>

      {/* Footer */}
      <div className="flex flex-col gap-2 p-2">
        <ProfileAccountDropdownContainer user={user} />
      </div>
    </aside>
  );
}
