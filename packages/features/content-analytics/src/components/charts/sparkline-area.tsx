'use client';

import { useMemo, useState } from 'react';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@kit/ui/tooltip';

import { formatNumber } from '../../lib/format';

export interface SparklineDataPoint {
  value: number;
  label: string;
}

interface SparklineAreaProps {
  /** Array of values to plot (for backward compatibility) */
  data?: number[];
  /** Array of labeled data points (preferred) */
  dataPoints?: SparklineDataPoint[];
  /** Width of the SVG */
  width?: number;
  /** Height of the SVG */
  height?: number;
  /** Stroke color */
  strokeColor?: string;
  /** Fill color (gradient will be applied) */
  fillColor?: string;
  /** Stroke width */
  strokeWidth?: number;
  /** Optional className */
  className?: string;
  /** Label for tooltip (e.g., "Views") */
  tooltipLabel?: string;
  /** Custom value formatter */
  valueFormatter?: (value: number) => string;
}

/**
 * SVG area chart with gradient fill - used for sparkline visualizations
 * Supports interactive tooltips when dataPoints with labels are provided
 */
export function SparklineArea({
  data,
  dataPoints,
  width = 200,
  height = 60,
  strokeColor = 'var(--analytics-green)',
  fillColor = 'var(--analytics-green)',
  strokeWidth = 2,
  className = '',
  tooltipLabel,
  valueFormatter = formatNumber,
}: SparklineAreaProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Normalize data to dataPoints format
  const normalizedData = useMemo(() => {
    if (dataPoints && dataPoints.length > 0) {
      return dataPoints;
    }
    if (data && data.length > 0) {
      return data.map((value, index) => ({
        value,
        label: `Point ${index + 1}`,
      }));
    }
    return [];
  }, [data, dataPoints]);

  if (normalizedData.length === 0) {
    return null;
  }

  const values = normalizedData.map((d) => d.value);
  const hasLabels = dataPoints && dataPoints.length > 0;

  const padding = 2;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;

  // Generate path points
  const points = values.map((value, index) => {
    const x = padding + (index / (values.length - 1)) * chartWidth;
    const y = padding + chartHeight - ((value - min) / range) * chartHeight;
    return { x, y, value, label: normalizedData[index]!.label };
  });

  // Simplified smooth path
  const smoothPath = points.reduce((path, point, index) => {
    if (index === 0) {
      return `M ${point.x},${point.y}`;
    }
    return `${path} L ${point.x},${point.y}`;
  }, '');

  // Area path (closed polygon)
  const lastPoint = points[points.length - 1]!;
  const firstPoint = points[0]!;
  const areaPath = `${smoothPath} L ${lastPoint.x},${height} L ${firstPoint.x},${height} Z`;

  const gradientId = `sparkline-gradient-${useMemo(() => Math.random().toString(36).substr(2, 9), [])}`;

  // If we have labeled data, render with tooltips
  if (hasLabels) {
    return (
      <TooltipProvider delayDuration={0}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className={className}
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={fillColor} stopOpacity="0.3" />
              <stop offset="100%" stopColor={fillColor} stopOpacity="0.05" />
            </linearGradient>
          </defs>
          {/* Area fill */}
          <path d={areaPath} fill={`url(#${gradientId})`} />
          {/* Line stroke */}
          <path
            d={smoothPath}
            fill="none"
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Interactive hover points */}
          {points.map((point, index) => (
            <Tooltip key={index}>
              <TooltipTrigger asChild>
                <g>
                  {/* Invisible larger hit area */}
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={12}
                    fill="transparent"
                    className="cursor-pointer"
                    onMouseEnter={() => setHoveredIndex(index)}
                    onMouseLeave={() => setHoveredIndex(null)}
                  />
                  {/* Visible dot on hover */}
                  {hoveredIndex === index && (
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r={4}
                      fill={strokeColor}
                      stroke="white"
                      strokeWidth={2}
                    />
                  )}
                </g>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                <div className="font-medium">{point.label}</div>
                <div className="text-muted-foreground">
                  {tooltipLabel ? `${tooltipLabel}: ` : ''}
                  {valueFormatter(point.value)}
                </div>
              </TooltipContent>
            </Tooltip>
          ))}
        </svg>
      </TooltipProvider>
    );
  }

  // Simple version without tooltips (backward compatible)
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={fillColor} stopOpacity="0.3" />
          <stop offset="100%" stopColor={fillColor} stopOpacity="0.05" />
        </linearGradient>
      </defs>
      {/* Area fill */}
      <path d={areaPath} fill={`url(#${gradientId})`} />
      {/* Line stroke */}
      <path
        d={smoothPath}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
