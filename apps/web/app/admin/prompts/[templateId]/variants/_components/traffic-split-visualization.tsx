'use client';

import { Badge } from '@kit/ui/badge';

interface TrafficSplitVisualizationProps {
  variants: Array<{
    id: string;
    variant_name: string;
    traffic_weight: number;
    is_active: boolean;
  }>;
  totalWeight: number;
}

export function TrafficSplitVisualization({
  variants,
  totalWeight,
}: TrafficSplitVisualizationProps) {
  const activeVariants = variants.filter((v) => v.is_active);

  if (activeVariants.length === 0) {
    return (
      <div className="text-muted-foreground text-center text-sm">
        No active variants
      </div>
    );
  }

  // Generate colors for variants
  const colors = [
    'bg-blue-500',
    'bg-green-500',
    'bg-purple-500',
    'bg-orange-500',
    'bg-pink-500',
    'bg-teal-500',
    'bg-indigo-500',
    'bg-red-500',
  ];

  return (
    <div className="space-y-4">
      {/* Visual bar */}
      <div className="flex h-12 w-full overflow-hidden rounded-lg">
        {activeVariants.map((variant, index) => {
          const percentage =
            totalWeight > 0
              ? (Number(variant.traffic_weight) / totalWeight) * 100
              : 0;

          if (percentage === 0) return null;

          return (
            <div
              key={variant.id}
              className={`${colors[index % colors.length]} flex items-center justify-center text-xs font-medium text-white transition-all hover:opacity-90`}
              style={{ width: `${percentage}%` }}
              title={`${variant.variant_name}: ${percentage.toFixed(1)}%`}
            >
              {percentage > 10 && (
                <span className="truncate px-2">{percentage.toFixed(0)}%</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {activeVariants.map((variant, index) => {
          const percentage =
            totalWeight > 0
              ? (Number(variant.traffic_weight) / totalWeight) * 100
              : 0;

          return (
            <div key={variant.id} className="flex items-center gap-2">
              <div
                className={`${colors[index % colors.length]} h-3 w-3 rounded-sm`}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {variant.variant_name}
                </p>
                <p className="text-muted-foreground text-xs">
                  {percentage.toFixed(1)}% ({variant.traffic_weight})
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Warning if total weight != 100 */}
      {totalWeight !== 100 && totalWeight > 0 && (
        <Badge variant="destructive" className="w-full justify-center">
          Warning: Total traffic weight is {totalWeight.toFixed(0)}% (should be
          100%)
        </Badge>
      )}
    </div>
  );
}
