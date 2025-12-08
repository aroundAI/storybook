'use client';

import type { ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';

import { useDeviceState } from '../../hooks/use-media-query';
import type { DeviceState } from '../../hooks/use-media-query';

/**
 * Responsive text size classes aligned with Tailwind breakpoints
 */
export const textScale = {
  h1: 'text-2xl sm:text-3xl lg:text-4xl',
  h2: 'text-xl sm:text-2xl lg:text-3xl',
  h3: 'text-lg sm:text-xl lg:text-2xl',
  h4: 'text-base sm:text-lg lg:text-xl',
  body: 'text-sm sm:text-base',
  small: 'text-xs sm:text-sm',
  caption: 'text-[10px] sm:text-xs',
} as const;

export type TextScaleKey = keyof typeof textScale;

/**
 * Responsive spacing classes for consistent layout margins/padding
 */
export const spacingScale = {
  page: 'px-4 sm:px-6 lg:px-8',
  section: 'py-4 sm:py-6 lg:py-8',
  card: 'p-3 sm:p-4 lg:p-6',
  gap: 'gap-3 sm:gap-4 lg:gap-6',
} as const;

export type SpacingScaleKey = keyof typeof spacingScale;

/**
 * Grid column configurations for responsive layouts
 */
export const gridColumns = {
  shots:
    'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5',
  assets:
    'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6',
  episodes: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
  cards: 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3',
} as const;

export type GridColumnsKey = keyof typeof gridColumns;

/**
 * Sidebar configurations for different breakpoints
 */
export const sidebarConfig = {
  width: {
    collapsed: 64,
    expanded: 240,
  },
  breakpoint: 1280, // xl breakpoint
} as const;

/**
 * Layout context for sharing responsive state
 */
interface LayoutContextValue extends DeviceState {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

const LayoutContext = createContext<LayoutContextValue | null>(null);

/**
 * Hook to access layout context
 *
 * @example
 * ```tsx
 * function Component() {
 *   const { isMobile, sidebarOpen } = useLayoutContext();
 *   // ...
 * }
 * ```
 */
export function useLayoutContext(): LayoutContextValue {
  const context = useContext(LayoutContext);
  if (!context) {
    throw new Error('useLayoutContext must be used within ResponsiveLayout');
  }
  return context;
}

/**
 * Props for ResponsiveLayout component
 */
interface ResponsiveLayoutProps {
  children: ReactNode;
  sidebar?: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  sidebarOpen?: boolean;
  onSidebarOpenChange?: (open: boolean) => void;
  className?: string;
}

/**
 * Main responsive layout component for Film Studio pages
 *
 * Provides a consistent layout structure that adapts to different screen sizes:
 * - Desktop (≥1280px): Fixed sidebar + main content
 * - Tablet (768-1279px): Collapsible sidebar sheet + full-width content
 * - Mobile (<768px): Full-width content + bottom navigation
 *
 * @example
 * ```tsx
 * <ResponsiveLayout
 *   sidebar={<StudioSidebar />}
 *   header={<StudioHeader />}
 *   footer={<MobileNav />}
 * >
 *   <EpisodeContent />
 * </ResponsiveLayout>
 * ```
 */
export function ResponsiveLayout({
  children,
  sidebar,
  header,
  footer,
  sidebarOpen = false,
  onSidebarOpenChange,
  className = '',
}: ResponsiveLayoutProps) {
  const deviceState = useDeviceState();
  const { isDesktop, isMobile } = deviceState;

  const contextValue = useMemo<LayoutContextValue>(
    () => ({
      ...deviceState,
      sidebarOpen,
      setSidebarOpen: onSidebarOpenChange ?? (() => {}),
    }),
    [deviceState, sidebarOpen, onSidebarOpenChange],
  );

  return (
    <LayoutContext.Provider value={contextValue}>
      <div className={`bg-background flex min-h-screen flex-col ${className}`}>
        {header && (
          <header className="bg-background/95 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-40 border-b backdrop-blur">
            {header}
          </header>
        )}

        <div className="flex flex-1">
          {/* Desktop Sidebar */}
          {isDesktop && sidebar && (
            <aside
              className="bg-background sticky top-14 h-[calc(100vh-3.5rem)] w-60 shrink-0 border-r"
              style={{ width: sidebarConfig.width.expanded }}
            >
              {sidebar}
            </aside>
          )}

          {/* Main Content */}
          <main
            className={`flex-1 ${spacingScale.page} ${spacingScale.section}`}
          >
            {children}
          </main>
        </div>

        {/* Mobile Footer/Navigation */}
        {isMobile && footer && (
          <footer className="bg-background/95 supports-[backdrop-filter]:bg-background/60 sticky bottom-0 z-40 border-t backdrop-blur">
            {footer}
          </footer>
        )}
      </div>
    </LayoutContext.Provider>
  );
}

/**
 * Props for responsive conditional rendering
 */
interface ShowOnProps {
  mobile?: boolean;
  tablet?: boolean;
  desktop?: boolean;
  children: ReactNode;
}

/**
 * Conditionally render content based on device type
 *
 * @example
 * ```tsx
 * <ShowOn mobile tablet>
 *   <MobileView />
 * </ShowOn>
 * <ShowOn desktop>
 *   <DesktopView />
 * </ShowOn>
 * ```
 */
export function ShowOn({
  mobile = false,
  tablet = false,
  desktop = false,
  children,
}: ShowOnProps) {
  const { isMobile, isTablet, isDesktop } = useDeviceState();

  const shouldShow =
    (mobile && isMobile) || (tablet && isTablet) || (desktop && isDesktop);

  if (!shouldShow) return null;

  return <>{children}</>;
}

/**
 * Conditionally hide content based on device type
 *
 * @example
 * ```tsx
 * <HideOn mobile>
 *   <DetailedSidebar />
 * </HideOn>
 * ```
 */
export function HideOn({
  mobile = false,
  tablet = false,
  desktop = false,
  children,
}: ShowOnProps) {
  const { isMobile, isTablet, isDesktop } = useDeviceState();

  const shouldHide =
    (mobile && isMobile) || (tablet && isTablet) || (desktop && isDesktop);

  if (shouldHide) return null;

  return <>{children}</>;
}

/**
 * Props for ResponsiveGrid component
 */
interface ResponsiveGridProps {
  children: ReactNode;
  variant?: GridColumnsKey;
  className?: string;
}

/**
 * Responsive grid component with predefined column configurations
 *
 * @example
 * ```tsx
 * <ResponsiveGrid variant="shots">
 *   {shots.map(shot => <ShotCard key={shot.id} shot={shot} />)}
 * </ResponsiveGrid>
 * ```
 */
export function ResponsiveGrid({
  children,
  variant = 'cards',
  className = '',
}: ResponsiveGridProps) {
  return (
    <div
      className={`grid ${gridColumns[variant]} ${spacingScale.gap} ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * Props for ResponsiveContainer component
 */
interface ResponsiveContainerProps {
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  className?: string;
}

/**
 * Responsive container with max-width constraints
 *
 * @example
 * ```tsx
 * <ResponsiveContainer size="lg">
 *   <PageContent />
 * </ResponsiveContainer>
 * ```
 */
export function ResponsiveContainer({
  children,
  size = 'xl',
  className = '',
}: ResponsiveContainerProps) {
  const sizeClasses = {
    sm: 'max-w-2xl',
    md: 'max-w-4xl',
    lg: 'max-w-6xl',
    xl: 'max-w-7xl',
    full: 'max-w-full',
  };

  return (
    <div className={`mx-auto w-full ${sizeClasses[size]} ${className}`}>
      {children}
    </div>
  );
}

/**
 * Props for AspectRatioBox component
 */
interface AspectRatioBoxProps {
  children: ReactNode;
  ratio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
  className?: string;
}

/**
 * Responsive aspect ratio container for video/image content
 *
 * @example
 * ```tsx
 * <AspectRatioBox ratio="16:9">
 *   <VideoPlayer src={videoUrl} />
 * </AspectRatioBox>
 * ```
 */
export function AspectRatioBox({
  children,
  ratio = '16:9',
  className = '',
}: AspectRatioBoxProps) {
  const aspectClasses = {
    '16:9': 'aspect-video',
    '9:16': 'aspect-[9/16]',
    '1:1': 'aspect-square',
    '4:3': 'aspect-[4/3]',
    '3:4': 'aspect-[3/4]',
  };

  return (
    <div
      className={`relative overflow-hidden ${aspectClasses[ratio]} ${className}`}
    >
      {children}
    </div>
  );
}
