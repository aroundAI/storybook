'use client';

import { useMemo } from 'react';

import { Line, LineChart, ResponsiveContainer, YAxis } from 'recharts';

interface SparklineChartProps {
  data: number[];
  color?: string;
  height?: number;
  width?: number;
  showDots?: boolean;
}

export function SparklineChart({
  data,
  color = '#6366F1',
  height = 30,
  width = 100,
  showDots = false,
}: SparklineChartProps) {
  const chartData = useMemo(
    () => data.map((value, index) => ({ index, value })),
    [data],
  );

  const minValue = Math.min(...data);
  const maxValue = Math.max(...data);

  return (
    <ResponsiveContainer width={width} height={height}>
      <LineChart
        data={chartData}
        margin={{ top: 2, right: 2, bottom: 2, left: 2 }}
      >
        <YAxis domain={[minValue, maxValue]} hide />
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={1.5}
          dot={
            showDots
              ? {
                  r: 2,
                  fill: color,
                  strokeWidth: 0,
                }
              : false
          }
          activeDot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
