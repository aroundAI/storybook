'use client';

interface HeatmapGridProps {
  /** 2D array of values (rows x columns), values should be 0-1 for opacity */
  data: number[][];
  /** Column labels (e.g., days of week) */
  columnLabels?: string[];
  /** Row labels (e.g., time slots) */
  rowLabels?: string[];
  /** Base color for heatmap */
  color?: string;
  /** Optional className */
  className?: string;
}

/**
 * Heatmap grid with opacity-based coloring - used for peak activity visualization
 */
export function HeatmapGrid({
  data,
  columnLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
  rowLabels,
  color = 'rgb(59, 130, 246)', // blue-500
  className = '',
}: HeatmapGridProps) {
  if (!data || data.length === 0) {
    return null;
  }

  const rows = data.length;
  const cols = data[0]?.length || 0;

  return (
    <div className={className}>
      {/* Column labels */}
      {columnLabels && (
        <div
          className="mb-1 grid gap-1 text-center text-[10px] text-gray-500 dark:text-gray-400"
          style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
        >
          {columnLabels.map((label, i) => (
            <div key={i}>{label}</div>
          ))}
        </div>
      )}
      {/* Grid */}
      <div className="flex gap-1">
        {/* Row labels */}
        {rowLabels && (
          <div className="flex flex-col justify-between text-[10px] text-gray-500 dark:text-gray-400">
            {rowLabels.map((label, i) => (
              <div key={i} className="flex h-full items-center pr-1">
                {label}
              </div>
            ))}
          </div>
        )}
        {/* Heatmap cells */}
        <div
          className="grid flex-1 gap-1"
          style={{
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridTemplateRows: `repeat(${rows}, 1fr)`,
          }}
        >
          {data.flat().map((value, index) => (
            <div
              key={index}
              className="aspect-square rounded-sm"
              style={{
                backgroundColor: color,
                opacity: Math.max(value, 0.1),
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
