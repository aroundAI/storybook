'use client';

import { useMemo } from 'react';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@kit/ui/tooltip';

import { formatNumber } from '../../lib/format';

export interface BarDataPoint {
  value: number;
  label: string;
}

interface MiniBarChartProps {
  /** Array of values (for backward compatibility) */
  data?: number[];
  /** Array of labeled data points (preferred) */
  dataPoints?: BarDataPoint[];
  /** Bar color or array of colors */
  color?: string | string[];
  /** Gap between bars */
  gap?: number;
  /** Optional className */
  className?: string;
  /** Label for tooltip (e.g., "Likes") */
  tooltipLabel?: string;
  /** Custom value formatter */
  valueFormatter?: (value: number) => string;
}

/**
 * Mini vertical bar chart - used for compact metric visualizations
 * Supports interactive tooltips when dataPoints with labels are provided
 */
export function MiniBarChart({
  data,
  dataPoints,
  color = 'var(--analytics-blue)',
  gap = 4,
  className = '',
  tooltipLabel,
  valueFormatter = formatNumber,
}: MiniBarChartProps) {
  // Normalize data to dataPoints format
  const normalizedData = useMemo(() => {
    if (dataPoints && dataPoints.length > 0) {
      return dataPoints;
    }
    if (data && data.length > 0) {
      return data.map((value, index) => ({
        value,
        label: `Bar ${index + 1}`,
      }));
    }
    return [];
  }, [data, dataPoints]);

  if (normalizedData.length === 0) {
    return null;
  }

  const values = normalizedData.map((d) => d.value);
  const hasLabels = dataPoints && dataPoints.length > 0;
  const max = Math.max(...values);
  const barCount = values.length;

  // Calculate opacity levels for gradient effect
  const getOpacity = (index: number) => {
    const baseOpacity = 0.2;
    const maxOpacity = 1;
    return baseOpacity + (index / (barCount - 1)) * (maxOpacity - baseOpacity);
  };

  // If we have labeled data, render with tooltips
  if (hasLabels) {
    return (
      <TooltipProvider delayDuration={0}>
        <div
          className={`flex h-16 w-full items-end justify-between ${className}`}
          style={{ gap: `${gap}px` }}
        >
          {normalizedData.map((point, index) => {
            const height = max > 0 ? (point.value / max) * 100 : 0;
            const barColor = Array.isArray(color)
              ? color[index % color.length]
              : color;
            const opacity = getOpacity(index);

            return (
              <Tooltip key={index}>
                <TooltipTrigger asChild>
                  <div
                    className="flex-1 cursor-pointer rounded-t transition-all duration-300 hover:opacity-100"
                    style={{
                      height: `${Math.max(height, 10)}%`,
                      backgroundColor: barColor,
                      opacity,
                    }}
                  />
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <div className="font-medium">{point.label}</div>
                  <div className="text-muted-foreground">
                    {tooltipLabel ? `${tooltipLabel}: ` : ''}
                    {valueFormatter(point.value)}
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>
    );
  }

  // Simple version without tooltips (backward compatible)
  return (
    <div
      className={`flex h-16 w-full items-end justify-between ${className}`}
      style={{ gap: `${gap}px` }}
    >
      {values.map((value, index) => {
        const height = max > 0 ? (value / max) * 100 : 0;
        const barColor = Array.isArray(color)
          ? color[index % color.length]
          : color;
        const opacity = getOpacity(index);

        return (
          <div
            key={index}
            className="flex-1 rounded-t transition-all duration-300"
            style={{
              height: `${Math.max(height, 10)}%`,
              backgroundColor: barColor,
              opacity,
            }}
          />
        );
      })}
    </div>
  );
}
