'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import {
  CheckCircle,
  Clock,
  ExternalLink,
  Loader2,
  Music,
  RotateCw,
  Sparkles,
  Video,
  X,
  XCircle,
} from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Progress } from '@kit/ui/progress';
import { ScrollArea } from '@kit/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kit/ui/tabs';

import type { GenerationStatusJob } from '../server/generation-status-actions';
import {
  cancelJobAction,
  retryJobAction,
} from '../server/generation-status-actions';

interface GenerationStatusPanelProps {
  accountId: string;
  jobs: GenerationStatusJob[];
}

const JOB_ICONS = {
  video: Video,
  voice: Music,
  music: Music,
  story: Sparkles,
} as const;

export function GenerationStatusPanel({
  accountId,
  jobs,
}: GenerationStatusPanelProps) {
  const activeJobs = jobs.filter((j) =>
    ['queued', 'processing'].includes(j.status),
  );
  const completedJobs = jobs.filter((j) => j.status === 'completed');
  const failedJobs = jobs.filter((j) => j.status === 'failed');

  return (
    <div>
      <div className="border-b p-4">
        <h3 className="font-semibold">Generation Status</h3>
        <p className="text-muted-foreground text-sm">
          {activeJobs.length} active, {completedJobs.length} completed
        </p>
      </div>

      <Tabs defaultValue="active" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="active">Active ({activeJobs.length})</TabsTrigger>
          <TabsTrigger value="completed">
            Done ({completedJobs.length})
          </TabsTrigger>
          <TabsTrigger value="failed">Failed ({failedJobs.length})</TabsTrigger>
        </TabsList>

        <ScrollArea className="h-80">
          <TabsContent value="active" className="m-0">
            <JobList accountId={accountId} jobs={activeJobs} type="active" />
          </TabsContent>

          <TabsContent value="completed" className="m-0">
            <JobList
              accountId={accountId}
              jobs={completedJobs}
              type="completed"
            />
          </TabsContent>

          <TabsContent value="failed" className="m-0">
            <JobList accountId={accountId} jobs={failedJobs} type="failed" />
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  );
}

function JobList({
  accountId,
  jobs,
  type,
}: {
  accountId: string;
  jobs: GenerationStatusJob[];
  type: 'active' | 'completed' | 'failed';
}) {
  if (jobs.length === 0) {
    return (
      <div className="text-muted-foreground p-8 text-center">
        {type === 'active' && 'No active generations'}
        {type === 'completed' && 'No recent completions'}
        {type === 'failed' && 'No failed jobs'}
      </div>
    );
  }

  return (
    <div className="divide-y">
      {jobs.map((job) => (
        <JobItem key={job.id} accountId={accountId} job={job} />
      ))}
    </div>
  );
}

function JobItem({
  accountId,
  job,
}: {
  accountId: string;
  job: GenerationStatusJob;
}) {
  const queryClient = useQueryClient();
  const Icon = JOB_ICONS[job.jobType] || Sparkles;

  const cancelMutation = useMutation({
    mutationFn: () => cancelJobAction({ accountId, jobId: job.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['generation-status'] });
    },
  });

  const retryMutation = useMutation({
    mutationFn: () => retryJobAction({ accountId, jobId: job.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['generation-status'] });
    },
  });

  return (
    <div className="space-y-2 p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Icon className="text-muted-foreground h-4 w-4" />
          <div>
            <p className="line-clamp-1 text-sm font-medium">{job.name}</p>
            <p className="text-muted-foreground text-xs">{job.projectName}</p>
          </div>
        </div>
        <StatusBadge status={job.status} />
      </div>

      {job.status === 'processing' && (
        <div className="space-y-1">
          <Progress value={job.progress} className="h-1.5" />
          <div className="text-muted-foreground flex items-center justify-between text-xs">
            <span>{job.progress}%</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2"
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
            >
              <X className="mr-1 h-3 w-3" />
              Cancel
            </Button>
          </div>
        </div>
      )}

      {job.status === 'queued' && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            Queued{' '}
            {formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2"
            onClick={() => cancelMutation.mutate()}
            disabled={cancelMutation.isPending}
          >
            <X className="mr-1 h-3 w-3" />
            Cancel
          </Button>
        </div>
      )}

      {job.status === 'completed' && job.outputUrl && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            Completed{' '}
            {job.completedAt &&
              formatDistanceToNow(new Date(job.completedAt), {
                addSuffix: true,
              })}
          </span>
          <Button variant="ghost" size="sm" className="h-6 px-2" asChild>
            <a href={job.outputUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-1 h-3 w-3" />
              View
            </a>
          </Button>
        </div>
      )}

      {job.status === 'failed' && (
        <div className="space-y-2">
          <p className="line-clamp-2 text-xs text-red-600">{job.error}</p>
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            onClick={() => retryMutation.mutate()}
            disabled={retryMutation.isPending}
          >
            <RotateCw className="mr-1 h-3 w-3" />
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: GenerationStatusJob['status'] }) {
  const variants = {
    queued: {
      icon: Clock,
      label: 'Queued',
      className: 'bg-slate-100 text-slate-700',
    },
    processing: {
      icon: Loader2,
      label: 'Processing',
      className: 'bg-blue-100 text-blue-700',
    },
    completed: {
      icon: CheckCircle,
      label: 'Done',
      className: 'bg-green-100 text-green-700',
    },
    failed: {
      icon: XCircle,
      label: 'Failed',
      className: 'bg-red-100 text-red-700',
    },
    cancelled: {
      icon: X,
      label: 'Cancelled',
      className: 'bg-gray-100 text-gray-700',
    },
  };

  const { icon: Icon, label, className } = variants[status];

  return (
    <Badge variant="outline" className={className}>
      <Icon
        className={`mr-1 h-3 w-3 ${status === 'processing' ? 'animate-spin' : ''}`}
      />
      {label}
    </Badge>
  );
}
