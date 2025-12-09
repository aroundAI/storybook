'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { FileText, Film, Settings, User } from 'lucide-react';

import { cn } from '@kit/ui/utils';

interface StudioSidebarProps {
  project: {
    id: string;
    name: string;
  };
  account: string;
}

export function StudioSidebar({ project, account }: StudioSidebarProps) {
  const pathname = usePathname();

  const baseUrl = `/home/${account}/studio/${project.id}`;

  const navItems = [
    {
      href: baseUrl,
      label: 'Dashboard',
      icon: Film,
    },
    {
      href: `${baseUrl}/assets`,
      label: 'Assets',
      icon: User,
    },
    {
      href: `${baseUrl}/episodes`,
      label: 'Episodes',
      icon: FileText,
    },
    {
      href: `${baseUrl}/settings`,
      label: 'Settings',
      icon: Settings,
    },
  ];

  return (
    <aside className="bg-muted/10 flex w-64 flex-col border-r">
      <div className="border-b p-6">
        <Link
          href={`/home/${account}/studio`}
          className="text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          &larr; All Projects
        </Link>
        <h2 className="mt-2 truncate text-lg font-semibold">{project.name}</h2>
      </div>
      <nav className="flex-1 p-4">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === baseUrl
                ? pathname === baseUrl
                : pathname.startsWith(item.href);

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted',
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
