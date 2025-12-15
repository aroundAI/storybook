'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

import {
    ArrowLeft,
    AudioLines,
    BarChart3,
    Check,
    ChevronDown,
    Clapperboard,
    FolderOpen,
    LayoutDashboard,
    MapPin,
    Menu,
    Search,
    Settings,
    Users,
} from 'lucide-react';

import { cn } from '@kit/ui/utils';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';
import { Input } from '@kit/ui/input';
import { Sheet, SheetContent, SheetTrigger } from '@kit/ui/sheet';

import { ProfileAccountDropdownContainer } from '~/components/personal-account-dropdown-container';
import { JWTUserData } from '@kit/supabase/types';

interface MobileStudioHeaderProps {
    project: {
        id: string;
        name: string;
    };
    account: string;
    recentProjects: Array<{
        id: string;
        name: string;
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
                    : 'text-sidebar-foreground'
            )}
        >
            <span className="w-4 h-4 shrink-0">{icon}</span>
            <span className="truncate flex-1">{label}</span>
            {count !== undefined && (
                <span className="text-xs tabular-nums">{count}</span>
            )}
        </Link>
    );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
    return (
        <h3 className="px-2 mb-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
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

    const basePath = `/home/${account}/studio/${project.id}`;

    const isActive = (path: string, exact = false) => {
        if (exact) return pathname === path;
        return pathname.startsWith(path);
    };

    const filteredProjects = recentProjects.filter((p) =>
        p.name.toLowerCase().includes(search.toLowerCase())
    );

    const navigateToProject = (projectId: string) => {
        setIsProjectSwitcherOpen(false);
        setIsOpen(false);
        router.push(`/home/${account}/studio/${projectId}`);
    };

    const closeSheet = () => setIsOpen(false);

    return (
        <div className="md:hidden flex items-center justify-between p-4 border-b bg-sidebar">
            <Sheet open={isOpen} onOpenChange={setIsOpen}>
                <SheetTrigger asChild>
                    <button className="p-2 hover:bg-sidebar-accent rounded-md transition-colors">
                        <Menu className="h-5 w-5" />
                    </button>
                </SheetTrigger>
                <SheetContent side="left" className="w-[280px] p-0 bg-sidebar">
                    <div className="flex h-full flex-col">
                        {/* Header */}
                        <div className="flex flex-col gap-2 p-3 border-b">
                            {/* Back to Projects */}
                            <Link
                                href={`/home/${account}/studio`}
                                onClick={closeSheet}
                                className="flex items-center text-sm text-sidebar-foreground hover:text-sidebar-accent-foreground transition-colors"
                            >
                                <ArrowLeft className="w-4 h-4 mr-1" />
                                Projects
                            </Link>

                            {/* Project Switcher */}
                            <DropdownMenu open={isProjectSwitcherOpen} onOpenChange={setIsProjectSwitcherOpen}>
                                <DropdownMenuTrigger asChild>
                                    <button className="w-full flex items-center justify-between p-2 rounded-md hover:bg-sidebar-accent transition-colors">
                                        <div className="flex items-center gap-2">
                                            <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center">
                                                <FolderOpen className="w-4 h-4 text-muted-foreground" />
                                            </div>
                                            <div className="text-left">
                                                <h2 className="font-semibold text-sm text-sidebar-foreground leading-tight truncate max-w-[140px]">
                                                    {project.name}
                                                </h2>
                                                <p className="text-xs text-muted-foreground">Switch Project</p>
                                            </div>
                                        </div>
                                        <ChevronDown className={cn(
                                            'w-4 h-4 text-muted-foreground transition-transform shrink-0',
                                            isProjectSwitcherOpen && 'rotate-180'
                                        )} />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent className="w-56" align="start" sideOffset={8}>
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
                                    <div className="max-h-[200px] overflow-y-auto">
                                        {filteredProjects.map((p) => (
                                            <DropdownMenuItem
                                                key={p.id}
                                                onClick={() => p.id !== project.id && navigateToProject(p.id)}
                                                className={p.id === project.id ? 'bg-muted' : 'cursor-pointer'}
                                            >
                                                <FolderOpen className="mr-2 h-4 w-4 text-muted-foreground" />
                                                <span className="truncate flex-1">{p.name}</span>
                                                {p.id === project.id && <Check className="h-4 w-4 text-primary ml-2" />}
                                            </DropdownMenuItem>
                                        ))}
                                    </div>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>

                        {/* Navigation */}
                        <div className="flex-1 overflow-y-auto p-3 space-y-4">
                            <div>
                                <SectionHeader>Application</SectionHeader>
                                <nav className="space-y-0.5">
                                    <NavItem
                                        href={basePath}
                                        icon={<LayoutDashboard className="w-4 h-4" />}
                                        label="Overview"
                                        isActive={isActive(basePath, true)}
                                        onClick={closeSheet}
                                    />
                                    <NavItem
                                        href={`${basePath}/episodes`}
                                        icon={<Clapperboard className="w-4 h-4" />}
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
                                        icon={<Users className="w-4 h-4" />}
                                        label="Characters"
                                        count={counts.characters}
                                        isActive={pathname.includes('/assets') && pathname.includes('character')}
                                        onClick={closeSheet}
                                    />
                                    <NavItem
                                        href={`${basePath}/assets?tab=location`}
                                        icon={<MapPin className="w-4 h-4" />}
                                        label="Locations"
                                        count={counts.locations}
                                        isActive={pathname.includes('/assets') && pathname.includes('location')}
                                        onClick={closeSheet}
                                    />
                                    <NavItem
                                        href={`${basePath}/assets?tab=voice`}
                                        icon={<AudioLines className="w-4 h-4" />}
                                        label="Voices"
                                        isActive={pathname.includes('/assets') && pathname.includes('voice')}
                                        onClick={closeSheet}
                                    />
                                </nav>
                            </div>

                            <div>
                                <SectionHeader>Settings</SectionHeader>
                                <nav className="space-y-0.5">
                                    <NavItem
                                        href={`${basePath}/analytics`}
                                        icon={<BarChart3 className="w-4 h-4" />}
                                        label="Analytics"
                                        isActive={isActive(`${basePath}/analytics`)}
                                        onClick={closeSheet}
                                    />
                                    <NavItem
                                        href={`${basePath}/settings`}
                                        icon={<Settings className="w-4 h-4" />}
                                        label="Project Settings"
                                        isActive={isActive(`${basePath}/settings`)}
                                        onClick={closeSheet}
                                    />
                                </nav>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="p-3 border-t">
                            <ProfileAccountDropdownContainer user={user} />
                        </div>
                    </div>
                </SheetContent>
            </Sheet>

            {/* Project Name */}
            <h1 className="font-semibold text-sm truncate max-w-[200px]">{project.name}</h1>

            {/* User Avatar - simplified for mobile */}
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-medium">
                {user.email?.[0]?.toUpperCase() || 'U'}
            </div>
        </div>
    );
}
