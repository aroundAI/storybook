'use client';

interface DonutSegment {
  value: number;
  color: string;
  label?: string;
  /** `data-test` for this segment's legend percentage. */
  testId?: string;
}

interface DonutChartProps {
  /** Segments to display */
  segments: DonutSegment[];
  /** Size of the chart */
  size?: number;
  /** Thickness of the donut */
  thickness?: number;
  /** Center label (e.g., main percentage) */
  centerLabel?: string;
  /** Center sublabel */
  centerSublabel?: string;
  /** Show legend below */
  showLegend?: boolean;
  /** Optional className */
  className?: string;
}

/**
 * SVG donut chart with segments - used for shares and gender distribution
 */
export function DonutChart({
  segments,
  size = 128,
  thickness = 12,
  centerLabel,
  centerSublabel,
  showLegend = false,
  className = '',
}: DonutChartProps) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) return null;

  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  // Calculate stroke-dasharray and stroke-dashoffset for each segment
  let currentOffset = 0;
  const segmentPaths = segments.map((segment) => {
    const percentage = segment.value / total;
    const dashArray = circumference * percentage;
    const dashOffset = -currentOffset;
    currentOffset += dashArray;

    return {
      ...segment,
      dashArray,
      dashOffset,
      percentage,
    };
  });

  return (
    <div className={`flex flex-col items-center ${className}`}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          {/* Background circle */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="transparent"
            stroke="currentColor"
            strokeWidth={thickness}
            className="text-gray-100 dark:text-gray-700"
          />
          {/* Segment circles */}
          {segmentPaths.map((segment, index) => (
            <circle
              key={index}
              cx={center}
              cy={center}
              r={radius}
              fill="transparent"
              stroke={segment.color}
              strokeWidth={thickness}
              strokeDasharray={`${segment.dashArray} ${circumference}`}
              strokeDashoffset={segment.dashOffset}
              strokeLinecap="round"
            />
          ))}
        </svg>
        {/* Center content */}
        {(centerLabel || centerSublabel) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {centerLabel && (
              <span className="text-2xl font-bold text-gray-900 dark:text-white">
                {centerLabel}
              </span>
            )}
            {centerSublabel && (
              <span className="text-[10px] font-semibold text-gray-500 uppercase dark:text-gray-400">
                {centerSublabel}
              </span>
            )}
          </div>
        )}
      </div>
      {/* Legend */}
      {showLegend && (
        <div className="mt-4 flex w-full justify-between px-4 text-xs">
          {segments.map((segment, index) => (
            <div key={index} className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: segment.color }}
              />
              <span className="text-gray-500 dark:text-gray-400">
                {segment.label}
              </span>
              <span
                className="font-semibold text-gray-900 dark:text-white"
                data-test={segment.testId}
              >
                {((segment.value / total) * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface SimpleDonutProps {
  /** Primary value (0-100) */
  value: number;
  /** Primary color */
  primaryColor?: string;
  /** Secondary color (remaining) */
  secondaryColor?: string;
  /** Size of the chart */
  size?: number;
  /** Thickness */
  thickness?: number;
  /** Optional className */
  className?: string;
}

/**
 * Simple two-segment donut - used for single metric displays
 */
export function SimpleDonut({
  value,
  primaryColor = 'rgb(59, 130, 246)', // blue-500
  secondaryColor = 'rgb(229, 231, 235)', // gray-200
  size = 64,
  thickness = 8,
  className = '',
}: SimpleDonutProps) {
  const segments: DonutSegment[] = [
    { value, color: primaryColor },
    { value: 100 - value, color: secondaryColor },
  ];

  return (
    <DonutChart
      segments={segments}
      size={size}
      thickness={thickness}
      className={className}
    />
  );
}
