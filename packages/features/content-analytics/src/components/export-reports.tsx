'use client';

import { useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';
import { endOfMonth, format, startOfMonth, subDays, subMonths } from 'date-fns';
import {
  Calendar as CalendarIcon,
  Download,
  FileText,
  Loader2,
  Table,
} from 'lucide-react';

import { refusalMessage, unwrap } from '@kit/next/action-result';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Calendar } from '@kit/ui/calendar';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Checkbox } from '@kit/ui/checkbox';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@kit/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kit/ui/tabs';

import type {
  DatePreset,
  DatePresetConfig,
  GeneratedReport,
  ReportMetric,
  ReportPlatform,
} from '../lib/report-types';
import { generateReportAction } from '../server/report-actions';
import { ReportHistory, reportHistoryKey } from './report-history';
import { ScheduledReportsManager } from './scheduled-reports-manager';

const METRIC_OPTIONS: {
  id: ReportMetric;
  label: string;
  category: string;
}[] = [
  { id: 'views', label: 'Views', category: 'Engagement' },
  { id: 'watchTime', label: 'Watch Time', category: 'Engagement' },
  { id: 'likes', label: 'Likes', category: 'Engagement' },
  { id: 'comments', label: 'Comments', category: 'Engagement' },
  { id: 'shares', label: 'Shares', category: 'Engagement' },
  { id: 'subscribers', label: 'Subscribers Gained', category: 'Growth' },
  { id: 'revenue', label: 'Revenue', category: 'Monetization' },
  { id: 'retention', label: 'Retention Curve', category: 'Performance' },
  { id: 'ctr', label: 'Click-Through Rate', category: 'Performance' },
  {
    id: 'avgViewDuration',
    label: 'Avg View Duration',
    category: 'Performance',
  },
];

const DATE_PRESETS: DatePresetConfig[] = [
  {
    id: 'last7days',
    label: 'Last 7 Days',
    getRange: () => ({ start: subDays(new Date(), 7), end: new Date() }),
  },
  {
    id: 'last30days',
    label: 'Last 30 Days',
    getRange: () => ({ start: subDays(new Date(), 30), end: new Date() }),
  },
  {
    id: 'lastMonth',
    label: 'Last Month',
    getRange: () => ({
      start: startOfMonth(subMonths(new Date(), 1)),
      end: endOfMonth(subMonths(new Date(), 1)),
    }),
  },
  {
    id: 'lastQuarter',
    label: 'Last Quarter',
    getRange: () => ({ start: subMonths(new Date(), 3), end: new Date() }),
  },
  { id: 'custom', label: 'Custom Range', getRange: () => null },
];

const PLATFORM_OPTIONS: { id: ReportPlatform; label: string }[] = [
  { id: 'youtube', label: 'YouTube' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook', label: 'Facebook' },
];

interface ExportReportsProps {
  accountId: string;
}

export function ExportReports({ accountId }: ExportReportsProps) {
  const [reportType, setReportType] = useState<'pdf' | 'csv'>('pdf');
  const [datePreset, setDatePreset] = useState<DatePreset>('last30days');
  const [customDateRange, setCustomDateRange] = useState<{
    start?: Date;
    end?: Date;
  }>({});
  const [selectedMetrics, setSelectedMetrics] = useState<ReportMetric[]>([
    'views',
    'watchTime',
    'likes',
  ]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<ReportPlatform[]>([
    'youtube',
  ]);
  const [branding, setBranding] = useState<{
    logoUrl?: string;
    primaryColor?: string;
    companyName?: string;
  }>({});

  const queryClient = useQueryClient();
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedReport, setGeneratedReport] =
    useState<GeneratedReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const getDateRange = () => {
    if (datePreset === 'custom') {
      return customDateRange;
    }
    const preset = DATE_PRESETS.find((p) => p.id === datePreset);
    return (
      preset?.getRange() || { start: subDays(new Date(), 30), end: new Date() }
    );
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    setGeneratedReport(null);

    const dateRange = getDateRange();
    if (!dateRange?.start || !dateRange?.end) {
      setError('Please select a valid date range');
      setIsGenerating(false);
      return;
    }

    try {
      const result = await unwrap(
        generateReportAction({
          accountId,
          config: {
            type: reportType,
            dateRange: {
              start: dateRange.start,
              end: dateRange.end,
              preset: datePreset,
            },
            metrics: selectedMetrics,
            platforms: selectedPlatforms,
            branding: reportType === 'pdf' ? branding : undefined,
          },
        }),
      );

      setGeneratedReport(result);
      await queryClient.invalidateQueries({
        queryKey: reportHistoryKey(accountId),
      });
    } catch (err) {
      setError(refusalMessage(err, 'Failed to generate report'));
    } finally {
      setIsGenerating(false);
    }
  };

  const toggleMetric = (metric: ReportMetric) => {
    if (selectedMetrics.includes(metric)) {
      setSelectedMetrics(selectedMetrics.filter((m) => m !== metric));
    } else {
      setSelectedMetrics([...selectedMetrics, metric]);
    }
  };

  const togglePlatform = (platform: ReportPlatform) => {
    if (selectedPlatforms.includes(platform)) {
      setSelectedPlatforms(selectedPlatforms.filter((p) => p !== platform));
    } else {
      setSelectedPlatforms([...selectedPlatforms, platform]);
    }
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="generate">
        <TabsList>
          <TabsTrigger value="generate">Generate Report</TabsTrigger>
          <TabsTrigger value="history" data-test="report-history-tab">
            History
          </TabsTrigger>
          <TabsTrigger value="scheduled">Scheduled Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="generate" className="space-y-6">
          {/* Report Type */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Report Format</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setReportType('pdf')}
                  className={`rounded-lg border-2 p-4 transition-colors ${
                    reportType === 'pdf'
                      ? 'border-primary bg-primary/5'
                      : 'border-border'
                  }`}
                >
                  <FileText className="mx-auto mb-2 h-8 w-8" />
                  <p className="font-medium">PDF Report</p>
                  <p className="text-xs text-muted-foreground">
                    Visual charts, branded document
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setReportType('csv')}
                  data-test="export-format-csv"
                  className={`rounded-lg border-2 p-4 transition-colors ${
                    reportType === 'csv'
                      ? 'border-primary bg-primary/5'
                      : 'border-border'
                  }`}
                >
                  <Table className="mx-auto mb-2 h-8 w-8" />
                  <p className="font-medium">CSV Export</p>
                  <p className="text-xs text-muted-foreground">
                    Raw data for spreadsheets
                  </p>
                </button>
              </div>
            </CardContent>
          </Card>

          {/* Date Range */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Date Range</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Select
                value={datePreset}
                onValueChange={(v) => setDatePreset(v as DatePreset)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATE_PRESETS.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {datePreset === 'custom' && (
                <div className="flex gap-4">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline">
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {customDateRange.start
                          ? format(customDateRange.start, 'PPP')
                          : 'Start date'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent>
                      <Calendar
                        mode="single"
                        selected={customDateRange.start}
                        onSelect={(date) =>
                          setCustomDateRange((prev) => ({
                            ...prev,
                            start: date,
                          }))
                        }
                      />
                    </PopoverContent>
                  </Popover>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline">
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {customDateRange.end
                          ? format(customDateRange.end, 'PPP')
                          : 'End date'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent>
                      <Calendar
                        mode="single"
                        selected={customDateRange.end}
                        onSelect={(date) =>
                          setCustomDateRange((prev) => ({ ...prev, end: date }))
                        }
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Metrics */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Metrics to Include</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                {METRIC_OPTIONS.map((metric) => (
                  <label
                    key={metric.id}
                    className="flex cursor-pointer items-center gap-2"
                  >
                    <Checkbox
                      checked={selectedMetrics.includes(metric.id)}
                      onCheckedChange={() => toggleMetric(metric.id)}
                    />
                    <span className="text-sm">{metric.label}</span>
                    <Badge variant="outline" className="text-xs">
                      {metric.category}
                    </Badge>
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Platforms */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Platforms</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4">
                {PLATFORM_OPTIONS.map((platform) => (
                  <label
                    key={platform.id}
                    className="flex cursor-pointer items-center gap-2"
                  >
                    <Checkbox
                      checked={selectedPlatforms.includes(platform.id)}
                      onCheckedChange={() => togglePlatform(platform.id)}
                    />
                    <span className="text-sm">{platform.label}</span>
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Branding (PDF only) */}
          {reportType === 'pdf' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Branding (Optional)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="companyName">Company Name</Label>
                    <Input
                      id="companyName"
                      placeholder="Your Company"
                      value={branding.companyName || ''}
                      onChange={(e) =>
                        setBranding((prev) => ({
                          ...prev,
                          companyName: e.target.value || undefined,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="logoUrl">Logo URL</Label>
                    <Input
                      id="logoUrl"
                      placeholder="https://..."
                      value={branding.logoUrl || ''}
                      onChange={(e) =>
                        setBranding((prev) => ({
                          ...prev,
                          logoUrl: e.target.value || undefined,
                        }))
                      }
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Error */}
          {error && (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="pt-6">
                <p className="text-sm text-red-800">{error}</p>
              </CardContent>
            </Card>
          )}

          {/* Generate Button */}
          <Button
            size="lg"
            className="w-full"
            onClick={handleGenerate}
            data-test="export-generate"
            disabled={
              isGenerating ||
              selectedMetrics.length === 0 ||
              selectedPlatforms.length === 0
            }
          >
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating Report...
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Generate {reportType.toUpperCase()} Report
              </>
            )}
          </Button>

          {/* Success */}
          {generatedReport && (
            <Card
              className="border-green-200 bg-green-50"
              data-test="export-report-ready"
            >
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-green-800">Report Ready!</p>
                    <p className="text-sm text-green-600">
                      {generatedReport.recordCount} records included
                    </p>
                  </div>
                  <Button asChild>
                    <a href={generatedReport.downloadUrl} download>
                      <Download className="mr-2 h-4 w-4" />
                      Download
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history">
          <ReportHistory accountId={accountId} />
        </TabsContent>

        <TabsContent value="scheduled">
          <ScheduledReportsManager accountId={accountId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
