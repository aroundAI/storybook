'use client';

import { useMemo } from 'react';

import { Bar, BarChart, CartesianGrid, XAxis } from 'recharts';

import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@kit/ui/chart';

const chartData = [
  { month: 'Jan', views: 4200, watchTime: 2100 },
  { month: 'Feb', views: 5800, watchTime: 3400 },
  { month: 'Mar', views: 7100, watchTime: 4600 },
  { month: 'Apr', views: 6400, watchTime: 3900 },
  { month: 'May', views: 8900, watchTime: 5800 },
  { month: 'Jun', views: 11200, watchTime: 7200 },
];

const chartConfig = {
  views: {
    label: 'Views',
    color: 'var(--chart-1)',
  },
  watchTime: {
    label: 'Watch time (min)',
    color: 'var(--chart-2)',
  },
} satisfies ChartConfig;

export function Default() {
  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>Episode performance</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-64 w-full">
          <BarChart accessibilityLayer data={chartData}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
            />
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent indicator="dot" />}
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="views" fill="var(--color-views)" radius={4} />
            <Bar dataKey="watchTime" fill="var(--color-watchTime)" radius={4} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

export function Minimal() {
  const data = useMemo(
    () => [
      { name: 'Ep 1', value: 4 },
      { name: 'Ep 2', value: 6.4 },
      { name: 'Ep 3', value: 5.1 },
      { name: 'Ep 4', value: 8.2 },
    ],
    [],
  );

  return (
    <ChartContainer config={chartConfig} className="h-48 w-full max-w-sm">
      <BarChart accessibilityLayer data={data}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="name" tickLine={false} axisLine={false} />
        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
        <Bar dataKey="value" fill="var(--color-views)" radius={4} />
      </BarChart>
    </ChartContainer>
  );
}
