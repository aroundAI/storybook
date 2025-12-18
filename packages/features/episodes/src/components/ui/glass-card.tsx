'use client';

import type { ReactNode } from 'react';

import { cn } from '@kit/ui/utils';

export interface GlassCardProps {
  children: ReactNode;
  className?: string;
  variant?: 'default' | 'light' | 'solid';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  rounded?: 'md' | 'lg' | 'xl' | '2xl' | '3xl';
  hover?: boolean;
}

const paddingClasses = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

const roundedClasses = {
  md: 'rounded-md',
  lg: 'rounded-lg',
  xl: 'rounded-xl',
  '2xl': 'rounded-2xl',
  '3xl': 'rounded-3xl',
};

/**
 * GlassCard - Apple HIG-inspired glass morphism card
 *
 * @example
 * <GlassCard variant="light" padding="lg" rounded="2xl">
 *   Content here
 * </GlassCard>
 */
export function GlassCard({
  children,
  className,
  variant = 'default',
  padding = 'md',
  rounded = '2xl',
  hover = false,
}: GlassCardProps) {
  return (
    <div
      className={cn(
        // Base styles
        'transition-all duration-200',
        // Variant styles
        variant === 'default' && 'liquid-card',
        variant === 'light' && 'liquid-card-light',
        variant === 'solid' && 'shadow-apple border-border/50 border bg-white',
        // Padding
        paddingClasses[padding],
        // Rounded corners
        roundedClasses[rounded],
        // Hover effect
        hover && 'hover:shadow-apple-lg hover:-translate-y-0.5',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * GlassPanel - Larger glass container for sidebars and sections
 */
export function GlassPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'glass-strong border-glass-border rounded-2xl border p-4',
        className,
      )}
    >
      {children}
    </div>
  );
}
