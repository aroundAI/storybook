'use client';

import type { ReactNode } from 'react';

/**
 * Navigation item for mobile bottom navigation
 */
export interface MobileNavItem {
  id: string;
  label: string;
  icon: ReactNode;
  href?: string;
  onClick?: () => void;
  badge?: number | string;
  disabled?: boolean;
}

/**
 * Props for MobileNav component
 */
interface MobileNavProps {
  items: MobileNavItem[];
  activeId?: string;
  onItemClick?: (item: MobileNavItem) => void;
  className?: string;
}

/**
 * Mobile bottom navigation component for Film Studio
 *
 * Displays a fixed bottom navigation bar with icon tabs for quick access
 * to main sections on mobile devices.
 *
 * @example
 * ```tsx
 * const navItems: MobileNavItem[] = [
 *   { id: 'story', label: 'Story', icon: <BookOpen />, href: '/story' },
 *   { id: 'visual', label: 'Visual', icon: <Video />, href: '/visual' },
 *   { id: 'audio', label: 'Audio', icon: <Music />, href: '/audio' },
 *   { id: 'edit', label: 'Edit', icon: <Scissors />, href: '/edit' },
 *   { id: 'publish', label: 'Publish', icon: <Upload />, href: '/publish' },
 * ];
 *
 * <MobileNav items={navItems} activeId="story" />
 * ```
 */
export function MobileNav({
  items,
  activeId,
  onItemClick,
  className = '',
}: MobileNavProps) {
  const handleClick = (item: MobileNavItem) => {
    if (item.disabled) return;
    item.onClick?.();
    onItemClick?.(item);
  };

  return (
    <nav
      className={`bg-background flex h-16 items-center justify-around border-t ${className}`}
      role="navigation"
      aria-label="Mobile navigation"
    >
      {items.map((item) => {
        const isActive = item.id === activeId;
        const isDisabled = item.disabled;

        return (
          <button
            key={item.id}
            type="button"
            onClick={() => handleClick(item)}
            disabled={isDisabled}
            className={`relative flex min-w-[64px] flex-1 flex-col items-center justify-center gap-1 py-2 transition-colors duration-200 ${
              isActive
                ? 'text-primary'
                : isDisabled
                  ? 'text-muted-foreground/50 cursor-not-allowed'
                  : 'text-muted-foreground hover:text-foreground'
            } `}
            aria-current={isActive ? 'page' : undefined}
            aria-disabled={isDisabled}
          >
            {/* Icon */}
            <span className="relative">
              {item.icon}

              {/* Badge */}
              {item.badge !== undefined && (
                <span
                  className="bg-destructive text-destructive-foreground absolute -right-2 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-medium"
                  aria-label={`${item.badge} notifications`}
                >
                  {typeof item.badge === 'number' && item.badge > 99
                    ? '99+'
                    : item.badge}
                </span>
              )}
            </span>

            {/* Label */}
            <span className="text-[10px] font-medium leading-none">
              {item.label}
            </span>

            {/* Active indicator */}
            {isActive && (
              <span className="bg-primary absolute top-0 h-0.5 w-8 rounded-full" />
            )}
          </button>
        );
      })}
    </nav>
  );
}

/**
 * Props for MobileNavLink component (for use with Next.js Link)
 */
interface MobileNavLinkProps {
  item: MobileNavItem;
  isActive: boolean;
  LinkComponent?: React.ComponentType<{
    href: string;
    children: ReactNode;
    className?: string;
  }>;
}

/**
 * Individual mobile nav link component
 *
 * Use this when you need to integrate with Next.js Link or other routing solutions.
 *
 * @example
 * ```tsx
 * import Link from 'next/link';
 *
 * <MobileNavLink
 *   item={{ id: 'home', label: 'Home', icon: <Home />, href: '/' }}
 *   isActive={pathname === '/'}
 *   LinkComponent={Link}
 * />
 * ```
 */
export function MobileNavLink({
  item,
  isActive,
  LinkComponent,
}: MobileNavLinkProps) {
  const content = (
    <>
      <span className="relative">
        {item.icon}
        {item.badge !== undefined && (
          <span className="bg-destructive text-destructive-foreground absolute -right-2 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-medium">
            {typeof item.badge === 'number' && item.badge > 99
              ? '99+'
              : item.badge}
          </span>
        )}
      </span>
      <span className="text-[10px] font-medium leading-none">{item.label}</span>
      {isActive && (
        <span className="bg-primary absolute top-0 h-0.5 w-8 rounded-full" />
      )}
    </>
  );

  const className = `
    relative flex min-w-[64px] flex-1 flex-col items-center justify-center gap-1 py-2
    transition-colors duration-200
    ${
      isActive
        ? 'text-primary'
        : item.disabled
          ? 'text-muted-foreground/50 cursor-not-allowed'
          : 'text-muted-foreground hover:text-foreground'
    }
  `;

  if (LinkComponent && item.href && !item.disabled) {
    return (
      <LinkComponent href={item.href} className={className}>
        {content}
      </LinkComponent>
    );
  }

  return (
    <button
      type="button"
      onClick={item.onClick}
      disabled={item.disabled}
      className={className}
      aria-current={isActive ? 'page' : undefined}
    >
      {content}
    </button>
  );
}

/**
 * Props for MobileHeader component
 */
interface MobileHeaderProps {
  title?: string;
  leftAction?: ReactNode;
  rightAction?: ReactNode;
  className?: string;
}

/**
 * Mobile header component with action slots
 *
 * @example
 * ```tsx
 * <MobileHeader
 *   title="Story Studio"
 *   leftAction={<BackButton />}
 *   rightAction={<SettingsButton />}
 * />
 * ```
 */
export function MobileHeader({
  title,
  leftAction,
  rightAction,
  className = '',
}: MobileHeaderProps) {
  return (
    <header
      className={`bg-background flex h-14 items-center justify-between gap-4 border-b px-4 ${className}`}
    >
      <div className="flex min-w-[40px] items-center">{leftAction}</div>

      {title && (
        <h1 className="flex-1 truncate text-center text-base font-semibold">
          {title}
        </h1>
      )}

      <div className="flex min-w-[40px] items-center justify-end">
        {rightAction}
      </div>
    </header>
  );
}

/**
 * Props for MobileActionBar component
 */
interface MobileActionBarProps {
  children: ReactNode;
  position?: 'top' | 'bottom';
  className?: string;
}

/**
 * Sticky action bar for mobile (e.g., contextual actions, filters)
 *
 * @example
 * ```tsx
 * <MobileActionBar position="bottom">
 *   <Button onClick={handleSave}>Save Changes</Button>
 *   <Button variant="outline" onClick={handleCancel}>Cancel</Button>
 * </MobileActionBar>
 * ```
 */
export function MobileActionBar({
  children,
  position = 'bottom',
  className = '',
}: MobileActionBarProps) {
  const positionClasses = position === 'top' ? 'top-14' : 'bottom-16';

  return (
    <div
      className={`sticky ${positionClasses} bg-background/95 supports-[backdrop-filter]:bg-background/60 z-30 flex items-center gap-2 border-y px-4 py-3 backdrop-blur ${className} `}
    >
      {children}
    </div>
  );
}

/**
 * Props for MobileSheet component
 */
interface MobileSheetProps {
  children: ReactNode;
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  className?: string;
}

/**
 * Full-screen sheet for mobile (replaces dialogs on mobile)
 *
 * @example
 * ```tsx
 * <MobileSheet isOpen={isOpen} onClose={close} title="Select Asset">
 *   <AssetPickerContent />
 * </MobileSheet>
 * ```
 */
export function MobileSheet({
  children,
  isOpen,
  onClose,
  title,
  className = '',
}: MobileSheetProps) {
  if (!isOpen) return null;

  return (
    <div className="bg-background fixed inset-0 z-50 flex flex-col">
      {/* Header */}
      <MobileHeader
        title={title}
        leftAction={
          <button
            type="button"
            onClick={onClose}
            className="hover:bg-accent flex h-10 w-10 items-center justify-center rounded-full"
            aria-label="Close"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        }
      />

      {/* Content */}
      <div className={`flex-1 overflow-auto ${className}`}>{children}</div>
    </div>
  );
}
