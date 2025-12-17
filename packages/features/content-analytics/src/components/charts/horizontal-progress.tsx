'use client';

interface HorizontalProgressProps {
  /** Label for the progress bar */
  label: string;
  /** Value between 0-100 */
  value: number;
  /** Bar color (Tailwind class or CSS value) */
  color?: string;
  /** Show percentage label */
  showPercentage?: boolean;
  /** Height of the bar */
  height?: 'sm' | 'md' | 'lg';
  /** Optional className */
  className?: string;
}

/**
 * Horizontal progress bar with label - used for platform splits and breakdowns
 */
export function HorizontalProgress({
  label,
  value,
  color = 'bg-primary',
  showPercentage = true,
  height = 'sm',
  className = '',
}: HorizontalProgressProps) {
  const heightClasses = {
    sm: 'h-2',
    md: 'h-3',
    lg: 'h-4',
  };

  return (
    <div className={className}>
      <div className="mb-1 flex justify-between text-xs">
        <span className="font-medium text-gray-900 dark:text-white">
          {label}
        </span>
        {showPercentage && (
          <span className="text-gray-500 dark:text-gray-400">
            {value.toFixed(1)}%
          </span>
        )}
      </div>
      <div
        className={`w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700 ${heightClasses[height]}`}
      >
        <div
          className={`${heightClasses[height]} rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }}
        />
      </div>
    </div>
  );
}

interface StackedProgressProps {
  /** Items to display */
  items: Array<{
    label: string;
    value: number;
    color: string;
  }>;
  /** Optional className */
  className?: string;
}

/**
 * Stacked progress bars - used for revenue breakdowns
 */
export function StackedProgress({
  items,
  className = '',
}: StackedProgressProps) {
  return (
    <div className={`space-y-3 ${className}`}>
      {items.map((item, index) => (
        <HorizontalProgress
          key={index}
          label={item.label}
          value={item.value}
          color={item.color}
          height="sm"
        />
      ))}
    </div>
  );
}
