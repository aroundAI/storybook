'use client';

import { ReactNode } from 'react';

import { cn } from '@kit/ui/utils';

interface GradientBackgroundProps {
  children: ReactNode;
  className?: string;
  variant?: 'default' | 'hero' | 'section';
}

export function GradientBackground({
  children,
  className,
  variant = 'default',
}: GradientBackgroundProps) {
  const variants = {
    default:
      'bg-gradient-to-b from-slate-50 via-white to-slate-50/50 dark:from-slate-950 dark:via-slate-900 dark:to-black',
    hero: 'bg-gradient-to-b from-white via-slate-50 to-slate-100 dark:from-slate-900 dark:via-slate-950 dark:to-black',
    section:
      'bg-gradient-to-b from-slate-50/50 via-white to-slate-50 dark:from-black dark:via-slate-950/50 dark:to-black',
  };

  return (
    <div
      className={cn(
        'relative min-h-screen overflow-hidden',
        variants[variant],
        className,
      )}
    >
      {/* Ambient glow orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute top-20 -left-40 h-80 w-80 rounded-full bg-gradient-to-br from-indigo-500/10 to-blue-500/5 blur-3xl dark:from-indigo-500/20 dark:to-blue-500/10"
          style={{ animation: 'pulse 8s ease-in-out infinite' }}
        />
        <div
          className="absolute top-60 -right-40 h-96 w-96 rounded-full bg-gradient-to-br from-violet-500/10 to-purple-500/5 blur-3xl dark:from-violet-500/15 dark:to-purple-500/10"
          style={{
            animation: 'pulse 10s ease-in-out infinite',
            animationDelay: '2s',
          }}
        />
        <div
          className="absolute bottom-20 left-1/3 h-72 w-72 rounded-full bg-gradient-to-br from-teal-500/5 to-emerald-500/5 blur-3xl dark:from-teal-500/10 dark:to-emerald-500/5"
          style={{
            animation: 'pulse 12s ease-in-out infinite',
            animationDelay: '4s',
          }}
        />
      </div>
      <div className="relative z-10">{children}</div>
    </div>
  );
}

interface HeroBackgroundProps {
  imageUrl?: string | null;
  fallbackColor?: string;
  children: ReactNode;
  className?: string;
}

export function HeroBackground({
  imageUrl,
  fallbackColor = '#0f172a',
  children,
  className,
}: HeroBackgroundProps) {
  return (
    <div className={cn('relative overflow-hidden', className)}>
      {/* Background image with blur and dark overlay */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage: imageUrl ? `url(${imageUrl})` : undefined,
          backgroundColor: !imageUrl ? fallbackColor : undefined,
        }}
      />
      {/* Blur overlay */}
      <div className="absolute inset-0 backdrop-blur-xl" />
      {/* Dark gradient overlay - stays dark for readability over images */}
      <div className="absolute inset-0 bg-gradient-to-t from-white via-white/80 to-white/40 dark:from-black dark:via-black/80 dark:to-black/40" />
      {/* Content */}
      <div className="relative z-10">{children}</div>
    </div>
  );
}
