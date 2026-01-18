'use client';

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
  Menu,
  Music,
  Search,
  Settings,
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
import { Sheet, SheetContent, SheetTrigger } from '@kit/ui/sheet';
import { cn } from '@kit/ui/utils';

import { ProfileAccountDropdownContainer } from '~/components/personal-account-dropdown-container';

interface MobileStudioHeaderProps {
  project: {
    id: string;
    name: string;
    slug: string | null;
  };
  account: string;
  recentProjects: Array<{
    id: string;
    name: string;
    slug: string | null;
    updated_at?: string;
  }>;
  user: JWTUserData;
  counts: {
    episodes?: number;
    characters?: number;
    locations?: number;
  };
}

function NavItem({
  href,
  icon,
  label,
  count,
  isActive,
  onClick,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  count?: number;
  isActive?: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm transition-colors',
        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        isActive
          ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
          : 'text-sidebar-foreground',
      )}
    >
      <span className="h-4 w-4 shrink-0">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && (
        <span className="text-xs tabular-nums">{count}</span>
      )}
    </Link>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-muted-foreground mb-1 px-2 text-xs font-medium tracking-wide uppercase">
      {children}
    </h3>
  );
}

export function MobileStudioHeader({
  project,
  account,
  recentProjects,
  user,
  counts,
}: MobileStudioHeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isProjectSwitcherOpen, setIsProjectSwitcherOpen] = useState(false);
  const [search, setSearch] = useState('');

  const basePath = `/home/${account}/studio/${project.slug ?? project.id}`;

  const isActive = (path: string, exact = false) => {
    if (exact) return pathname === path;
    return pathname.startsWith(path);
  };

  const filteredProjects = recentProjects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()),
  );

  const navigateToProject = (projectSlug: string) => {
    setIsProjectSwitcherOpen(false);
    setIsOpen(false);
    router.push(`/home/${account}/studio/${projectSlug}`);
  };

  const closeSheet = () => setIsOpen(false);

  return (
    <div className="bg-sidebar flex items-center justify-between border-b p-4 md:hidden">
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetTrigger asChild>
          <button className="hover:bg-sidebar-accent rounded-md p-2 transition-colors">
            <Menu className="h-5 w-5" />
          </button>
        </SheetTrigger>
        <SheetContent side="left" className="bg-sidebar w-[280px] p-0">
          <div className="flex h-full flex-col">
            {/* Header */}
            <div className="flex flex-col gap-2 border-b p-3">
              {/* Back to Projects */}
              <Link
                href={`/home/${account}/studio`}
                onClick={closeSheet}
                className="text-sidebar-foreground hover:text-sidebar-accent-foreground flex items-center text-sm transition-colors"
              >
                <ArrowLeft className="mr-1 h-4 w-4" />
                Projects
              </Link>

              {/* Project Switcher */}
              <DropdownMenu
                open={isProjectSwitcherOpen}
                onOpenChange={setIsProjectSwitcherOpen}
              >
                <DropdownMenuTrigger asChild>
                  <button className="hover:bg-sidebar-accent flex w-full items-center justify-between rounded-md p-2 transition-colors">
                    <div className="flex items-center gap-2">
                      <div className="bg-muted flex h-8 w-8 items-center justify-center rounded-md">
                        <FolderOpen className="text-muted-foreground h-4 w-4" />
                      </div>
                      <div className="text-left">
                        <h2 className="text-sidebar-foreground max-w-[140px] truncate text-sm leading-tight font-semibold">
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
                  <div className="max-h-[200px] overflow-y-auto">
                    {filteredProjects.map((p) => (
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
                    ))}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Navigation */}
            <div className="flex-1 space-y-4 overflow-y-auto p-3">
              <div>
                <SectionHeader>Application</SectionHeader>
                <nav className="space-y-0.5">
                  <NavItem
                    href={basePath}
                    icon={<LayoutDashboard className="h-4 w-4" />}
                    label="Overview"
                    isActive={isActive(basePath, true)}
                    onClick={closeSheet}
                  />
                  <NavItem
                    href={`${basePath}/episodes`}
                    icon={<Clapperboard className="h-4 w-4" />}
                    label="Episodes"
                    count={counts.episodes}
                    isActive={isActive(`${basePath}/episodes`)}
                    onClick={closeSheet}
                  />
                </nav>
              </div>

              <div>
                <SectionHeader>Assets</SectionHeader>
                <nav className="space-y-0.5">
                  <NavItem
                    href={`${basePath}/assets?tab=character`}
                    icon={<Users className="h-4 w-4" />}
                    label="Characters"
                    count={counts.characters}
                    isActive={
                      pathname.includes('/assets') &&
                      pathname.includes('character')
                    }
                    onClick={closeSheet}
                  />
                  <NavItem
                    href={`${basePath}/assets?tab=location`}
                    icon={<MapPin className="h-4 w-4" />}
                    label="Locations"
                    count={counts.locations}
                    isActive={
                      pathname.includes('/assets') &&
                      pathname.includes('location')
                    }
                    onClick={closeSheet}
                  />
                  <NavItem
                    href={`${basePath}/audio-library`}
                    icon={<Music className="h-4 w-4" />}
                    label="Audio Library"
                    isActive={pathname.includes('/audio-library')}
                    onClick={closeSheet}
                  />
                </nav>
              </div>

              <div>
                <SectionHeader>Settings</SectionHeader>
                <nav className="space-y-0.5">
                  <NavItem
                    href={`${basePath}/analytics`}
                    icon={<BarChart3 className="h-4 w-4" />}
                    label="Analytics"
                    isActive={isActive(`${basePath}/analytics`)}
                    onClick={closeSheet}
                  />
                  <NavItem
                    href={`${basePath}/settings`}
                    icon={<Settings className="h-4 w-4" />}
                    label="Project Settings"
                    isActive={isActive(`${basePath}/settings`)}
                    onClick={closeSheet}
                  />
                </nav>
              </div>
            </div>

            {/* Footer */}
            <div className="border-t p-3">
              <ProfileAccountDropdownContainer user={user} />
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Project Name */}
      <h1 className="max-w-[200px] truncate text-sm font-semibold">
        {project.name}
      </h1>

      {/* User Avatar - simplified for mobile */}
      <div className="bg-muted flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium">
        {user.email?.[0]?.toUpperCase() || 'U'}
      </div>
    </div>
  );
}
