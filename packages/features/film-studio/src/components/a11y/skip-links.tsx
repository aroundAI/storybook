'use client';

/**
 * Skip links component for keyboard navigation accessibility
 *
 * Provides links that allow keyboard users to skip directly to main content
 * or navigation, bypassing repetitive content.
 *
 * @example
 * ```tsx
 * // In your layout component
 * <body>
 *   <SkipLinks />
 *   <nav id="sidebar-nav">...</nav>
 *   <main id="main-content">...</main>
 * </body>
 * ```
 */
export interface SkipLinksProps {
  /** ID of the main content element (default: "main-content") */
  mainContentId?: string;
  /** ID of the navigation element (default: "sidebar-nav") */
  navigationId?: string;
  /** Additional skip links */
  additionalLinks?: Array<{
    href: string;
    label: string;
  }>;
  /** Custom class name for the container */
  className?: string;
}

export function SkipLinks({
  mainContentId = 'main-content',
  navigationId = 'sidebar-nav',
  additionalLinks,
  className,
}: SkipLinksProps) {
  const baseLinks = [
    { href: `#${mainContentId}`, label: 'Skip to main content' },
    { href: `#${navigationId}`, label: 'Skip to navigation' },
  ];

  const allLinks = additionalLinks
    ? [...baseLinks, ...additionalLinks]
    : baseLinks;

  return (
    <div
      className={`sr-only focus-within:not-sr-only focus-within:fixed focus-within:left-0 focus-within:top-0 focus-within:z-[9999] focus-within:flex focus-within:flex-col focus-within:gap-1 focus-within:p-2 ${className ?? ''}`}
    >
      {allLinks.map((link) => (
        <a
          key={link.href}
          href={link.href}
          className="bg-background text-foreground border-border focus:ring-primary border px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2"
        >
          {link.label}
        </a>
      ))}
    </div>
  );
}

/**
 * Hook for programmatically managing skip link targets
 *
 * Useful when you need to dynamically set skip link destinations
 * based on route or component state.
 */
export function useSkipLinkTarget(id: string) {
  return {
    id,
    tabIndex: -1,
    // Allow the element to receive focus when linked to
    style: { outline: 'none' } as const,
  };
}
