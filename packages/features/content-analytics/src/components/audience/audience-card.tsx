'use client';

import { MoreHorizontal } from 'lucide-react';

interface AudienceCardProps {
  /** Card title */
  title: string;
  /** Icon component */
  icon?: React.ComponentType<{ className?: string }>;
  /** Span 2 rows */
  rowSpan?: boolean;
  /** Footer insight text */
  footerInsight?: string;
  /** Children content */
  children: React.ReactNode;
  /** Optional className */
  className?: string;
}

/**
 * Base card component for Audience tab - matches prototype design
 */
export function AudienceCard({
  title,
  icon: Icon,
  rowSpan = false,
  footerInsight,
  children,
  className = '',
}: AudienceCardProps) {
  const rowSpanClass = rowSpan ? 'row-span-2' : '';

  return (
    <div
      className={`group flex h-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-shadow duration-300 hover:shadow-md dark:border-gray-800 dark:bg-gray-900 ${rowSpanClass} ${className}`}
    >
      {/* Card content */}
      <div className="flex flex-1 flex-col p-5">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
            {Icon && <Icon className="h-5 w-5 text-blue-500" />}
            {title}
          </h3>
          <button className="text-gray-400 transition-colors hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400">
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1">{children}</div>
      </div>

      {/* Footer with insight */}
      {footerInsight && (
        <div className="border-t border-gray-200 bg-gray-50 px-5 py-3 dark:border-gray-800 dark:bg-white/5">
          <p className="line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
            {footerInsight}
          </p>
        </div>
      )}
    </div>
  );
}
