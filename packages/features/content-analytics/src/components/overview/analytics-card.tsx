'use client';

import { Info } from 'lucide-react';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@kit/ui/tooltip';

interface AnalyticsCardProps {
  /** Card title */
  title: string;
  /** Icon component */
  icon?: React.ComponentType<{ className?: string }>;
  /** Tooltip description */
  description?: string;
  /** Number of columns to span (1 or 2) */
  colSpan?: 1 | 2;
  /** Card variant */
  variant?: 'default' | 'gradient';
  /** Badge text (e.g., "New") */
  badge?: string;
  /** Children content */
  children: React.ReactNode;
  /** Footer content */
  footer?: React.ReactNode;
  /** Optional className */
  className?: string;
}

/**
 * Base analytics card component matching the prototype design
 */
export function AnalyticsCard({
  title,
  icon: Icon,
  description,
  colSpan = 1,
  variant = 'default',
  badge,
  children,
  footer,
  className = '',
}: AnalyticsCardProps) {
  const colSpanClass = colSpan === 2 ? 'md:col-span-2' : '';
  const variantClasses =
    variant === 'gradient'
      ? 'bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-950/30 dark:to-purple-950/30 border-indigo-100 dark:border-indigo-800'
      : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800';

  return (
    <div
      className={`flex h-64 flex-col rounded-2xl border p-6 shadow-sm transition-all hover:shadow-md ${variantClasses} ${colSpanClass} ${className}`}
    >
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {Icon && (
            <Icon
              className={`h-4 w-4 ${variant === 'gradient' ? 'text-indigo-600' : 'text-gray-400'}`}
            />
          )}
          <h3
            className={`text-base font-semibold ${variant === 'gradient' ? 'text-indigo-900 dark:text-indigo-100' : 'text-gray-500 dark:text-gray-400'}`}
          >
            {title}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {badge && (
            <span className="rounded border border-indigo-100 bg-white px-2 py-0.5 text-[10px] font-bold tracking-wider text-indigo-700 uppercase dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
              {badge}
            </span>
          )}
          {description && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                    aria-label={`Info about ${title}`}
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs text-sm">{description}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col justify-center">{children}</div>

      {/* Footer */}
      {footer && (
        // A div, not a p. `footer` is ReactNode, and the deep-dive tab passes
        // a flex row of buttons — a <div> inside a <p> is invalid HTML, which
        // React logs as a hydration error and the parser fixes by closing the
        // <p> early, so the footer escaped the card's text styling. Tailwind's
        // preflight zeroes <p> margins, so nothing moves.
        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          {footer}
        </div>
      )}
    </div>
  );
}
