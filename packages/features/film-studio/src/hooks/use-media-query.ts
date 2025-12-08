'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

/**
 * Breakpoints aligned with Tailwind CSS default breakpoints
 * @see https://tailwindcss.com/docs/responsive-design
 */
export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

export type BreakpointKey = keyof typeof BREAKPOINTS;

/**
 * Hook to subscribe to media query changes
 *
 * @param query - CSS media query string
 * @returns boolean indicating if the media query matches
 *
 * @example
 * ```tsx
 * const isMobile = useMediaQuery('(max-width: 768px)');
 * const isDarkMode = useMediaQuery('(prefers-color-scheme: dark)');
 * ```
 */
export function useMediaQuery(query: string): boolean {
  const getSnapshot = useCallback(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  }, [query]);

  const getServerSnapshot = useCallback(() => false, []);

  const subscribe = useCallback(
    (callback: () => void) => {
      if (typeof window === 'undefined') return () => {};

      const mediaQuery = window.matchMedia(query);
      mediaQuery.addEventListener('change', callback);

      return () => {
        mediaQuery.removeEventListener('change', callback);
      };
    },
    [query],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Hook to check if viewport is at or above a specific breakpoint
 *
 * @param breakpoint - Tailwind breakpoint key
 * @returns boolean indicating if viewport is at or above the breakpoint
 *
 * @example
 * ```tsx
 * const isDesktop = useBreakpoint('xl');
 * const isTablet = useBreakpoint('md');
 * ```
 */
export function useBreakpoint(breakpoint: BreakpointKey): boolean {
  const minWidth = BREAKPOINTS[breakpoint];
  return useMediaQuery(`(min-width: ${minWidth}px)`);
}

/**
 * Hook to check if viewport is below a specific breakpoint
 *
 * @param breakpoint - Tailwind breakpoint key
 * @returns boolean indicating if viewport is below the breakpoint
 *
 * @example
 * ```tsx
 * const isMobile = useBreakpointDown('md');
 * ```
 */
export function useBreakpointDown(breakpoint: BreakpointKey): boolean {
  const maxWidth = BREAKPOINTS[breakpoint] - 1;
  return useMediaQuery(`(max-width: ${maxWidth}px)`);
}

/**
 * Hook to check if viewport is between two breakpoints
 *
 * @param start - Lower breakpoint (inclusive)
 * @param end - Upper breakpoint (exclusive)
 * @returns boolean indicating if viewport is within the range
 *
 * @example
 * ```tsx
 * const isTabletOnly = useBreakpointBetween('md', 'xl');
 * ```
 */
export function useBreakpointBetween(
  start: BreakpointKey,
  end: BreakpointKey,
): boolean {
  const minWidth = BREAKPOINTS[start];
  const maxWidth = BREAKPOINTS[end] - 1;
  return useMediaQuery(
    `(min-width: ${minWidth}px) and (max-width: ${maxWidth}px)`,
  );
}

/**
 * Responsive device state for Film Studio layouts
 */
export interface DeviceState {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isLargeDesktop: boolean;
  isTouch: boolean;
}

/**
 * Hook to get comprehensive device state for responsive layouts
 *
 * @returns DeviceState object with boolean flags for each device type
 *
 * @example
 * ```tsx
 * function ResponsiveComponent() {
 *   const { isMobile, isDesktop, isTouch } = useDeviceState();
 *
 *   if (isMobile) {
 *     return <MobileView />;
 *   }
 *
 *   return <DesktopView />;
 * }
 * ```
 */
export function useDeviceState(): DeviceState {
  const isMobile = useBreakpointDown('md');
  const isTablet = useBreakpointBetween('md', 'xl');
  const isDesktop = useBreakpoint('xl');
  const isLargeDesktop = useBreakpoint('2xl');
  const isTouch = useMediaQuery('(pointer: coarse)');

  return {
    isMobile,
    isTablet,
    isDesktop,
    isLargeDesktop,
    isTouch,
  };
}

/**
 * Hook to detect user's motion preference (for animations)
 *
 * @returns boolean indicating if reduced motion is preferred
 *
 * @example
 * ```tsx
 * const prefersReducedMotion = usePrefersReducedMotion();
 * const animationDuration = prefersReducedMotion ? 0 : 300;
 * ```
 */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

/**
 * Hook to detect user's color scheme preference
 *
 * @returns boolean indicating if dark mode is preferred
 *
 * @example
 * ```tsx
 * const prefersDarkMode = usePrefersDarkMode();
 * ```
 */
export function usePrefersDarkMode(): boolean {
  return useMediaQuery('(prefers-color-scheme: dark)');
}

/**
 * Hook to track viewport dimensions
 *
 * @returns object with current width and height
 *
 * @example
 * ```tsx
 * const { width, height } = useViewportSize();
 * const aspectRatio = width / height;
 * ```
 */
export function useViewportSize(): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    function updateSize() {
      setSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    }

    updateSize();
    window.addEventListener('resize', updateSize);

    return () => window.removeEventListener('resize', updateSize);
  }, []);

  return size;
}
