'use client';

/**
 * AnalyticsPreview Component
 *
 * Shows a quick peek of project analytics:
 * - Total views (7 days)
 * - Engagement rate
 * - Platform breakdown bars
 */
import Link from 'next/link';

import { ArrowRight, BarChart3, Eye, TrendingUp } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { cn } from '@kit/ui/utils';

interface PlatformData {
  platform: string;
  views: number;
  percentage: number;
}

interface AnalyticsPreviewProps {
  totalViews: number;
  engagementRate: number;
  platformBreakdown: PlatformData[];
  baseUrl: string;
}

const platformColors: Record<string, string> = {
  youtube: 'bg-red-500',
  tiktok: 'bg-black',
  instagram: 'bg-gradient-to-r from-purple-500 to-pink-500',
};

const platformLabels: Record<string, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
};

export function AnalyticsPreview({
  totalViews,
  engagementRate,
  platformBreakdown,
  baseUrl,
}: AnalyticsPreviewProps) {
  const hasData = totalViews > 0;

  // Format large numbers
  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart3 className="h-4 w-4" />
          Analytics Preview
        </CardTitle>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <div className="space-y-4">
            {/* Key Metrics */}
            <div className="flex gap-6">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10">
                  <Eye className="h-4 w-4 text-blue-500" />
                </div>
                <div>
                  <p className="text-lg font-bold">
                    {formatNumber(totalViews)}
                  </p>
                  <p className="text-xs text-muted-foreground">views (7d)</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500/10">
                  <TrendingUp className="h-4 w-4 text-green-500" />
                </div>
                <div>
                  <p className="text-lg font-bold">
                    {engagementRate.toFixed(1)}%
                  </p>
                  <p className="text-xs text-muted-foreground">engagement</p>
                </div>
              </div>
            </div>

            {/* Platform Breakdown */}
            {platformBreakdown.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Platform Distribution
                </p>
                <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                  {platformBreakdown.map((p) => (
                    <div
                      key={p.platform}
                      className={cn(
                        'h-full transition-all',
                        platformColors[p.platform] || 'bg-gray-400',
                      )}
                      style={{ width: `${p.percentage}%` }}
                      title={`${platformLabels[p.platform] || p.platform}: ${p.percentage.toFixed(1)}%`}
                    />
                  ))}
                </div>
                <div className="flex gap-4 text-xs">
                  {platformBreakdown.map((p) => (
                    <div key={p.platform} className="flex items-center gap-1">
                      <div
                        className={cn(
                          'h-2 w-2 rounded-full',
                          platformColors[p.platform] || 'bg-gray-400',
                        )}
                      />
                      <span className="text-muted-foreground">
                        {platformLabels[p.platform] || p.platform}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* View Full Analytics */}
            <Button variant="ghost" size="sm" className="w-full" asChild>
              <Link href={`${baseUrl}/analytics`}>
                View Full Analytics
                <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <BarChart3 className="mb-2 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No analytics data yet
            </p>
            <p className="text-xs text-muted-foreground">
              Publish content to start tracking performance
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
