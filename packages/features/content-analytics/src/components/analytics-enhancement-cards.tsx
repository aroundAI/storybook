'use client';

import {
  Award,
  BarChart3,
  Clapperboard,
  Scissors,
  TrendingUp,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Badge } from '@kit/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Skeleton } from '@kit/ui/skeleton';

import { formatNumber } from '../lib/format';
import type {
  ContentTypeComparison,
  LanguagePerformance,
} from '../server/language-analytics';

// =============================================================================
// Language Names & Colors
// =============================================================================

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
  ru: 'Russian',
  it: 'Italian',
};

const LANGUAGE_COLORS: Record<string, string> = {
  en: '#3B82F6', // Blue
  hi: '#F59E0B', // Amber
  es: '#EF4444', // Red
  pt: '#10B981', // Emerald
  fr: '#8B5CF6', // Violet
  de: '#EC4899', // Pink
  ja: '#F97316', // Orange
  ko: '#6366F1', // Indigo
  zh: '#14B8A6', // Teal
  ar: '#84CC16', // Lime
  ru: '#06B6D4', // Cyan
  it: '#22C55E', // Green
};

function getLanguageName(code: string): string {
  return LANGUAGE_NAMES[code] || code.toUpperCase();
}

function getLanguageColor(code: string): string {
  return LANGUAGE_COLORS[code] || '#6B7280';
}

// =============================================================================
// Language Comparison Chart (Side-by-Side)
// =============================================================================

interface LanguageComparisonChartProps {
  data: LanguagePerformance[] | null;
  isLoading?: boolean;
}

export function LanguageComparisonChart({
  data,
  isLoading,
}: LanguageComparisonChartProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4" />
            Language Comparison
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4" />
            Language Comparison
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No language data available. Publish content to see language
            performance comparison.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Prepare chart data
  const chartData = data.slice(0, 6).map((lang) => ({
    name: getLanguageName(lang.language),
    code: lang.language,
    views: lang.views,
    engagement: lang.engagement,
    revenue: lang.revenueCents / 100,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart3 className="h-4 w-4" />
          Language Comparison
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ left: 60 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis type="number" tickFormatter={(v) => formatNumber(v)} />
              <YAxis dataKey="name" type="category" width={60} />
              <Tooltip
                formatter={(value: number, name: string) => [
                  name === 'views'
                    ? formatNumber(value)
                    : name === 'engagement'
                      ? `${value.toFixed(1)}%`
                      : `$${value.toFixed(2)}`,
                  name.charAt(0).toUpperCase() + name.slice(1),
                ]}
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                }}
              />
              <Legend />
              <Bar
                dataKey="views"
                fill="#3B82F6"
                name="Views"
                radius={[0, 4, 4, 0]}
              >
                {chartData.map((entry) => (
                  <Cell key={entry.code} fill={getLanguageColor(entry.code)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Shorts ROI Calculator
// =============================================================================

interface ShortsROICardProps {
  contentTypeData: ContentTypeComparison | null;
  isLoading?: boolean;
}

export function ShortsROICard({
  contentTypeData,
  isLoading,
}: ShortsROICardProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Scissors className="h-4 w-4" />
            Shorts ROI Calculator
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!contentTypeData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Scissors className="h-4 w-4" />
            Shorts ROI Calculator
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No shorts data available. Publish shorts to see ROI analysis.
          </p>
        </CardContent>
      </Card>
    );
  }

  const { longForm, shorts } = contentTypeData;

  // Calculate ROI metrics
  const viewsPerShort =
    shorts.contentCount > 0 ? shorts.views / shorts.contentCount : 0;
  const viewsPerLongForm =
    longForm.contentCount > 0 ? longForm.views / longForm.contentCount : 0;
  const shortsMultiplier =
    viewsPerLongForm > 0 ? viewsPerShort / viewsPerLongForm : 0;
  const engagementDiff = shorts.engagement - longForm.engagement;
  const revenuePerView = {
    shorts: shorts.views > 0 ? shorts.revenueCents / shorts.views : 0,
    longForm: longForm.views > 0 ? longForm.revenueCents / longForm.views : 0,
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Scissors className="h-4 w-4" />
          Shorts ROI Calculator
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Views per content piece */}
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg bg-muted/50 p-4">
            <div className="mb-1 text-xs text-muted-foreground">
              Views/Short
            </div>
            <div className="text-2xl font-bold">
              {formatNumber(viewsPerShort)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {shorts.contentCount} shorts published
            </div>
          </div>
          <div className="rounded-lg bg-muted/50 p-4">
            <div className="mb-1 text-xs text-muted-foreground">Views/Long</div>
            <div className="text-2xl font-bold">
              {formatNumber(viewsPerLongForm)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {longForm.contentCount} long-form published
            </div>
          </div>
        </div>

        {/* ROI Insights */}
        <div className="space-y-2">
          <div className="flex items-center justify-between rounded-lg bg-muted/30 p-2">
            <span className="text-sm">Shorts reach multiplier</span>
            <Badge variant={shortsMultiplier > 1 ? 'default' : 'secondary'}>
              {shortsMultiplier > 0 ? `${shortsMultiplier.toFixed(1)}x` : 'N/A'}
            </Badge>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-muted/30 p-2">
            <span className="text-sm">Engagement difference</span>
            <Badge variant={engagementDiff > 0 ? 'default' : 'secondary'}>
              {engagementDiff > 0 ? '+' : ''}
              {engagementDiff.toFixed(1)}%
            </Badge>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-muted/30 p-2">
            <span className="text-sm">Revenue/view (shorts)</span>
            <Badge variant="outline">
              ${(revenuePerView.shorts / 100).toFixed(4)}
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Best Episodes to Clip Recommendations
// =============================================================================

interface BestEpisodesToClipProps {
  languageData: LanguagePerformance[] | null;
  contentTypeData: ContentTypeComparison | null;
  isLoading?: boolean;
}

export function BestEpisodesToClipCard({
  languageData,
  contentTypeData,
  isLoading,
}: BestEpisodesToClipProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Award className="h-4 w-4" />
            Clipping Recommendations
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  // Generate recommendations based on language and content type data
  const recommendations: {
    icon: React.ReactNode;
    title: string;
    description: string;
    priority: 'high' | 'medium' | 'low';
  }[] = [];

  // Check if shorts are performing well
  if (contentTypeData) {
    const { longForm, shorts } = contentTypeData;

    if (shorts.engagement > longForm.engagement) {
      recommendations.push({
        icon: <TrendingUp className="h-4 w-4 text-green-500" />,
        title: 'Shorts outperform long-form',
        description: `Shorts have ${(shorts.engagement - longForm.engagement).toFixed(1)}% higher engagement. Create more clips from high-performing episodes.`,
        priority: 'high',
      });
    }

    if (shorts.contentCount < longForm.contentCount) {
      recommendations.push({
        icon: <Scissors className="h-4 w-4 text-blue-500" />,
        title: 'Increase shorts production',
        description: `You have ${longForm.contentCount} long-form but only ${shorts.contentCount} shorts. Consider clipping more content.`,
        priority: 'medium',
      });
    }
  }

  // Check language opportunities
  if (languageData && languageData.length > 1) {
    const topLang = languageData[0];
    const secondLang = languageData[1];

    if (topLang && secondLang && topLang.views > secondLang.views * 2) {
      recommendations.push({
        icon: <Clapperboard className="h-4 w-4 text-amber-500" />,
        title: `Focus on ${getLanguageName(topLang.language)} clips`,
        description: `${getLanguageName(topLang.language)} content gets ${(topLang.views / (secondLang.views || 1)).toFixed(1)}x more views than ${getLanguageName(secondLang.language)}.`,
        priority: 'high',
      });
    }

    // Find underutilized language with high engagement
    const highEngagementLang = languageData.find(
      (l) => l.engagement > 5 && l.contentCount < 5,
    );
    if (highEngagementLang) {
      recommendations.push({
        icon: <TrendingUp className="h-4 w-4 text-purple-500" />,
        title: `Expand ${getLanguageName(highEngagementLang.language)} content`,
        description: `High engagement (${highEngagementLang.engagement.toFixed(1)}%) but low volume. Great opportunity for more clips.`,
        priority: 'medium',
      });
    }
  }

  // Default recommendation if none generated
  if (recommendations.length === 0) {
    recommendations.push({
      icon: <Scissors className="h-4 w-4 text-muted-foreground" />,
      title: 'Start publishing shorts',
      description:
        'Publish shorts from your best episodes to unlock clipping insights and recommendations.',
      priority: 'low',
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Award className="h-4 w-4" />
          Clipping Recommendations
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {recommendations.map((rec, index) => (
          <div
            key={index}
            className="flex items-start gap-3 rounded-lg bg-muted/30 p-3"
          >
            <div className="mt-0.5">{rec.icon}</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{rec.title}</span>
                <Badge
                  variant={
                    rec.priority === 'high'
                      ? 'default'
                      : rec.priority === 'medium'
                        ? 'secondary'
                        : 'outline'
                  }
                  className="text-xs"
                >
                  {rec.priority}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {rec.description}
              </p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Skeleton Components
// =============================================================================

export function LanguageComparisonChartSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-64 w-full" />
      </CardContent>
    </Card>
  );
}

export function ShortsROICardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-36" />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </CardContent>
    </Card>
  );
}

export function BestEpisodesToClipCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-44" />
      </CardHeader>
      <CardContent className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}
