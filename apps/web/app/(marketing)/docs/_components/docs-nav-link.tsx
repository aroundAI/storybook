'use client';

import { useRef } from 'react';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { SidebarMenuButton, SidebarMenuItem } from '@kit/ui/shadcn-sidebar';
import { cn, isRouteActive } from '@kit/ui/utils';

export function DocsNavLink({
  label,
  url,
  children,
}: React.PropsWithChildren<{ label: string; url: string }>) {
  const currentPath = usePathname();
  const ref = useRef<HTMLElement>(null);
  const isCurrent = isRouteActive(url, currentPath, true);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isCurrent}
        className={cn('transition-background font-normal!', {
          'text-secondary-foreground font-bold': isCurrent,
        })}
      >
        <Link href={url}>
          <span ref={ref} className="block max-w-full truncate">
            {label}
          </span>

          {children}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
