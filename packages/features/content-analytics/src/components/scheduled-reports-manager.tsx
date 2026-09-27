'use client';

import { useCallback, useEffect, useState } from 'react';

import { format } from 'date-fns';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  Loader2,
  Mail,
  Pause,
  Play,
  Plus,
  Trash2,
} from 'lucide-react';

import { refusalMessage, unwrap } from '@kit/next/action-result';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Card, CardContent } from '@kit/ui/card';
import { Checkbox } from '@kit/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@kit/ui/dialog';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';

import type {
  ReportMetric,
  ReportPlatform,
  ScheduledReport,
} from '../lib/report-types';
import {
  createScheduledReportAction,
  deleteScheduledReportAction,
  getScheduledReportsAction,
  updateScheduledReportAction,
} from '../server/report-actions';

const METRIC_OPTIONS: { id: ReportMetric; label: string }[] = [
  { id: 'views', label: 'Views' },
  { id: 'watchTime', label: 'Watch Time' },
  { id: 'likes', label: 'Likes' },
  { id: 'comments', label: 'Comments' },
  { id: 'shares', label: 'Shares' },
  { id: 'subscribers', label: 'Subscribers' },
  { id: 'revenue', label: 'Revenue' },
];

const PLATFORM_OPTIONS: { id: ReportPlatform; label: string }[] = [
  { id: 'youtube', label: 'YouTube' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook', label: 'Facebook' },
];

interface ScheduledReportsManagerProps {
  accountId: string;
}

export function ScheduledReportsManager({
  accountId,
}: ScheduledReportsManagerProps) {
  const [reports, setReports] = useState<ScheduledReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const loadReports = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getScheduledReportsAction({ accountId });
      setReports(data);
    } catch (err) {
      console.error('Failed to load scheduled reports:', err);
    } finally {
      setIsLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const handleToggleActive = async (report: ScheduledReport) => {
    try {
      await updateScheduledReportAction({
        id: report.id,
        isActive: !report.isActive,
      });
      await loadReports();
    } catch (err) {
      console.error('Failed to toggle report:', err);
    }
  };

  const handleDelete = async (reportId: string) => {
    if (!confirm('Are you sure you want to delete this scheduled report?')) {
      return;
    }
    try {
      await unwrap(deleteScheduledReportAction({ id: reportId }));
      await loadReports();
    } catch (err) {
      console.error('Failed to delete report:', err);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Scheduled Reports</h3>
          <p className="text-sm text-muted-foreground">
            Automatically generate and email reports on a schedule
          </p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Schedule
            </Button>
          </DialogTrigger>
          <CreateScheduleDialog
            accountId={accountId}
            onSuccess={() => {
              setIsCreateDialogOpen(false);
              void loadReports();
            }}
          />
        </Dialog>
      </div>

      {reports.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Calendar className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
            <p className="text-muted-foreground">No scheduled reports yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a schedule to automatically receive reports via email
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {reports.map((report) => (
            <Card
              key={report.id}
              className={!report.isActive ? 'opacity-60' : ''}
            >
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium">{report.name}</h4>
                      <Badge
                        variant={report.isActive ? 'default' : 'secondary'}
                      >
                        {report.isActive ? 'Active' : 'Paused'}
                      </Badge>
                      <Badge variant="outline">
                        {report.reportType.toUpperCase()}
                      </Badge>
                      <Badge variant="outline" className="capitalize">
                        {report.frequency}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        <span>
                          Next: {format(report.nextRunAt, 'MMM d, yyyy')}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Mail className="h-4 w-4" />
                        <span>
                          {report.recipients.length} recipient
                          {report.recipients.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      {report.lastRunAt && (
                        <div className="flex items-center gap-1">
                          {report.lastRunStatus === 'success' ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          ) : (
                            <AlertCircle className="h-4 w-4 text-red-500" />
                          )}
                          <span>
                            Last run: {format(report.lastRunAt, 'MMM d')}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {report.platforms.map((p) => (
                        <Badge key={p} variant="outline" className="text-xs">
                          {p}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleToggleActive(report)}
                      title={report.isActive ? 'Pause' : 'Resume'}
                    >
                      {report.isActive ? (
                        <Pause className="h-4 w-4" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(report.id)}
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {report.lastError && (
                  <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">
                    {report.lastError}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

interface CreateScheduleDialogProps {
  accountId: string;
  onSuccess: () => void;
}

function CreateScheduleDialog({
  accountId,
  onSuccess,
}: CreateScheduleDialogProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [reportType, setReportType] = useState<'pdf' | 'csv' | 'raw_csv'>(
    'pdf',
  );
  const [frequency, setFrequency] = useState<'weekly' | 'monthly'>('weekly');
  const [selectedMetrics, setSelectedMetrics] = useState<ReportMetric[]>([
    'views',
    'likes',
    'watchTime',
  ]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<ReportPlatform[]>([
    'youtube',
  ]);
  const [recipients, setRecipients] = useState('');

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

  const handleSubmit = async () => {
    setIsCreating(true);
    setError(null);

    const recipientList = recipients
      .split(',')
      .map((e) => e.trim())
      .filter((e) => e.length > 0);

    if (recipientList.length === 0) {
      setError('At least one recipient email is required');
      setIsCreating(false);
      return;
    }

    try {
      await createScheduledReportAction({
        accountId,
        name,
        reportType,
        frequency,
        metrics: selectedMetrics,
        platforms: selectedPlatforms,
        recipients: recipientList,
      });
      onSuccess();
    } catch (err) {
      setError(refusalMessage(err, 'Failed to create schedule'));
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>Create Scheduled Report</DialogTitle>
        <DialogDescription>
          Set up automatic report generation and email delivery
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="name">Report Name</Label>
          <Input
            id="name"
            placeholder="Weekly Performance Report"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Format</Label>
            <Select
              value={reportType}
              onValueChange={(v) =>
                setReportType(v as 'pdf' | 'csv' | 'raw_csv')
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pdf">PDF</SelectItem>
                <SelectItem value="csv">CSV summary</SelectItem>
                <SelectItem value="raw_csv">Raw data export</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Frequency</Label>
            <Select
              value={frequency}
              onValueChange={(v) => setFrequency(v as 'weekly' | 'monthly')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly (Mondays)</SelectItem>
                <SelectItem value="monthly">Monthly (1st)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Metrics</Label>
          <div className="grid grid-cols-2 gap-2">
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
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Platforms</Label>
          <div className="flex flex-wrap gap-3">
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
        </div>

        <div className="space-y-2">
          <Label htmlFor="recipients">
            Recipients (comma-separated emails)
          </Label>
          <Input
            id="recipients"
            placeholder="email@example.com, another@example.com"
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
          />
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">
            {error}
          </div>
        )}
      </div>

      <DialogFooter>
        <Button
          onClick={handleSubmit}
          disabled={
            isCreating ||
            !name ||
            selectedMetrics.length === 0 ||
            selectedPlatforms.length === 0
          }
        >
          {isCreating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating...
            </>
          ) : (
            'Create Schedule'
          )}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
