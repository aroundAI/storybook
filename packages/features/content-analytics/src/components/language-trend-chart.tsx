'use client';

import { useMemo } from 'react';

import { TrendingUp } from 'lucide-react';
import {
    Area,
    AreaChart,
    CartesianGrid,
    Legend,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';

import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Skeleton } from '@kit/ui/skeleton';

import type { LanguageTrendEntry } from '../server/language-analytics';

// Language colors for chart
const LANGUAGE_COLORS: Record<string, string> = {
    en: '#3b82f6', // Blue
    hi: '#f97316', // Orange
    es: '#eab308', // Yellow
    pt: '#22c55e', // Green
    fr: '#8b5cf6', // Purple
    de: '#ef4444', // Red
    ja: '#ec4899', // Pink
    ko: '#14b8a6', // Teal
    zh: '#f43f5e', // Rose
    ar: '#6366f1', // Indigo
};

const LANGUAGE_NAMES: Record<string, string> = {
    en: 'English',
    hi: 'Hindi',
    es: 'Spanish',
    pt: 'Portuguese',
    fr: 'French',
    de: 'German',
    ja: 'Japanese',
    ko: 'Korean',
    zh: 'Chinese',
    ar: 'Arabic',
};

interface LanguageTrendChartProps {
    data: LanguageTrendEntry[];
    isLoading?: boolean;
}

export function LanguageTrendChart({ data, isLoading }: LanguageTrendChartProps) {
    // Get unique languages from data
    const languages = useMemo(() => {
        const langSet = new Set<string>();
        for (const entry of data) {
            for (const lang of Object.keys(entry.viewsByLanguage)) {
                langSet.add(lang);
            }
        }
        return Array.from(langSet);
    }, [data]);

    // Transform data for Recharts
    const chartData = useMemo(() => {
        return data.map((entry) => ({
            date: entry.date,
            ...entry.viewsByLanguage,
        }));
    }, [data]);

    if (isLoading) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <TrendingUp className="h-4 w-4" />
                        Language Performance Trend
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <Skeleton className="h-[300px] w-full" />
                </CardContent>
            </Card>
        );
    }

    if (!data || data.length === 0 || languages.length === 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <TrendingUp className="h-4 w-4" />
                        Language Performance Trend
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground text-sm">
                        No trend data available. Publish content to see language trends.
                    </p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                    <TrendingUp className="h-4 w-4" />
                    Language Performance Trend
                </CardTitle>
            </CardHeader>
            <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis
                            dataKey="date"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value) => {
                                const date = new Date(value);
                                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                            }}
                        />
                        <YAxis
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value) =>
                                value >= 1000 ? `${(value / 1000).toFixed(0)}K` : value.toString()
                            }
                        />
                        <Tooltip
                            contentStyle={{
                                backgroundColor: 'hsl(var(--popover))',
                                border: '1px solid hsl(var(--border))',
                                borderRadius: '6px',
                            }}
                            labelFormatter={(value) => {
                                const date = new Date(value);
                                return date.toLocaleDateString('en-US', {
                                    weekday: 'short',
                                    month: 'short',
                                    day: 'numeric',
                                });
                            }}
                            formatter={(value: number, name: string) => [
                                value.toLocaleString(),
                                LANGUAGE_NAMES[name] || name,
                            ]}
                        />
                        <Legend
                            formatter={(value: string) => LANGUAGE_NAMES[value] || value}
                        />
                        {languages.map((lang) => (
                            <Area
                                key={lang}
                                type="monotone"
                                dataKey={lang}
                                stackId="1"
                                stroke={LANGUAGE_COLORS[lang] || '#888'}
                                fill={LANGUAGE_COLORS[lang] || '#888'}
                                fillOpacity={0.6}
                            />
                        ))}
                    </AreaChart>
                </ResponsiveContainer>
            </CardContent>
        </Card>
    );
}

export function LanguageTrendChartSkeleton() {
    return (
        <Card>
            <CardHeader>
                <Skeleton className="h-5 w-48" />
            </CardHeader>
            <CardContent>
                <Skeleton className="h-[300px] w-full" />
            </CardContent>
        </Card>
    );
}
