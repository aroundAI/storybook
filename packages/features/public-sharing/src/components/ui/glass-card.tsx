'use client';

import { ReactNode } from 'react';

import { cn } from '@kit/ui/utils';

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  glowColor?: 'indigo' | 'violet' | 'teal' | 'slate';
  glowPosition?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  hover?: boolean;
}

const glowColors = {
  indigo: 'from-indigo-400 to-blue-400',
  violet: 'from-violet-400 to-purple-400',
  teal: 'from-teal-400 to-emerald-400',
  slate: 'from-slate-400 to-slate-300',
};

const glowPositions = {
  'top-right': '-top-12 -right-12',
  'top-left': '-top-12 -left-12',
  'bottom-right': '-bottom-12 -right-12',
  'bottom-left': '-bottom-12 -left-12',
};

export function GlassCard({
  children,
  className,
  glowColor = 'indigo',
  glowPosition = 'top-right',
  hover = true,
}: GlassCardProps) {
  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-2xl',
        'border border-slate-200/50 bg-white/80 dark:border-white/[0.08] dark:bg-white/[0.03]',
        'backdrop-blur-md',
        hover &&
          'transition-all hover:-translate-y-0.5 hover:border-slate-300/50 hover:bg-white/90 hover:shadow-lg dark:hover:border-white/[0.12] dark:hover:bg-white/[0.05]',
        className,
      )}
    >
      {/* Animated glow orb */}
      <div
        className={cn(
          'absolute h-32 w-32 rounded-full opacity-50 blur-3xl',
          'bg-gradient-to-br',
          glowColors[glowColor],
          glowPositions[glowPosition],
          'animate-pulse',
        )}
        style={{ animationDuration: '3s' }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

interface GlassCardContentProps {
  children: ReactNode;
  className?: string;
}

export function GlassCardContent({
  children,
  className,
}: GlassCardContentProps) {
  return <div className={cn('p-5', className)}>{children}</div>;
}

interface GlassCardHeaderProps {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  className?: string;
}

export function GlassCardHeader({
  icon,
  title,
  subtitle,
  className,
}: GlassCardHeaderProps) {
  return (
    <div className={cn('p-5', className)}>
      {icon && (
        <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/5">
          {icon}
        </div>
      )}
      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
        {title}
      </h3>
      {subtitle && (
        <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
          {subtitle}
        </p>
      )}
    </div>
  );
}
