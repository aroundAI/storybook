# FILM-903: Generation Status Panel

## Metadata
- **Phase:** 9 - Integration
- **Priority:** P2 (Post-MVP)
- **Effort:** M (4-8 hours)
- **Dependencies:** FILM-404 (Job Queue), FILM-405 (Generate Action)
- **Blocks:** None

---

## Context

The Generation Status Panel provides a persistent, accessible view of all active and recent generation jobs. It appears as a collapsible panel or notification area, allowing creators to monitor progress without leaving their current workflow.

---

## Specification

### Requirements

1. **Persistent Display**: Always visible indicator when jobs are running
2. **Expandable Panel**: Click to see all active jobs
3. **Real-time Updates**: Live progress updates via polling
4. **Quick Actions**: Cancel, retry, or view completed jobs
5. **Notifications**: Alert when jobs complete or fail
6. **History**: Recent completed jobs for reference

### Status Indicator Component

```typescript
// packages/features/film-studio/src/components/generation-status-indicator.tsx

'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@kit/ui/button';
import { Badge } from '@kit/ui/badge';
import { Progress } from '@kit/ui/progress';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@kit/ui/popover';
import { Loader2, CheckCircle, XCircle, Clock, Pause } from 'lucide-react';
import { getGenerationStatusAction } from '../server/generation-status-actions';

interface GenerationStatusIndicatorProps {
  compact?: boolean;
}

export function GenerationStatusIndicator({ compact = false }: GenerationStatusIndicatorProps) {
  const [open, setOpen] = useState(false);

  const { data: status } = useQuery({
    queryKey: ['generation-status'],
    queryFn: getGenerationStatusAction,
    refetchInterval: (data) => {
      // Poll faster when jobs are active
      const hasActive = data?.jobs.some((j) => j.status === 'processing');
      return hasActive ? 2000 : 10000;
    },
  });

  const activeCount = status?.jobs.filter((j) => j.status === 'processing').length || 0;
  const queuedCount = status?.jobs.filter((j) => j.status === 'queued').length || 0;
  const hasActivity = activeCount > 0 || queuedCount > 0;

  if (compact) {
    return (
      <CompactIndicator
        activeCount={activeCount}
        queuedCount={queuedCount}
        onClick={() => setOpen(true)}
      />
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="relative"
        >
          {hasActivity ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="ml-2">{activeCount} generating</span>
              {queuedCount > 0 && (
                <Badge variant="secondary" className="ml-2 text-xs">
                  +{queuedCount}
                </Badge>
              )}
            </>
          ) : (
            <>
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">No active jobs</span>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        <GenerationStatusPanel jobs={status?.jobs || []} />
      </PopoverContent>
    </Popover>
  );
}

function CompactIndicator({
  activeCount,
  queuedCount,
  onClick,
}: {
  activeCount: number;
  queuedCount: number;
  onClick: () => void;
}) {
  const total = activeCount + queuedCount;

  if (total === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCircle className="h-4 w-4" />
        <span>All complete</span>
      </div>
    );
  }

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 text-sm hover:bg-accent p-2 rounded-md w-full"
    >
      <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
      <span>
        {activeCount} generating
        {queuedCount > 0 && `, ${queuedCount} queued`}
      </span>
    </button>
  );
}
```

### Generation Status Panel

```typescript
// packages/features/film-studio/src/components/generation-status-panel.tsx

'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kit/ui/tabs';
import { ScrollArea } from '@kit/ui/scroll-area';
import { Button } from '@kit/ui/button';
import { Progress } from '@kit/ui/progress';
import { Badge } from '@kit/ui/badge';
import {
  Loader2,
  CheckCircle,
  XCircle,
  RotateCw,
  X,
  Video,
  Music,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cancelJobAction, retryJobAction } from '../server/generation-status-actions';

interface GenerationJob {
  id: string;
  jobType: 'video' | 'voice' | 'music' | 'story';
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  name: string;
  projectName: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
  outputUrl?: string;
}

interface GenerationStatusPanelProps {
  jobs: GenerationJob[];
}

const JOB_ICONS = {
  video: Video,
  voice: Music,
  music: Music,
  story: Sparkles,
};

export function GenerationStatusPanel({ jobs }: GenerationStatusPanelProps) {
  const activeJobs = jobs.filter((j) => ['queued', 'processing'].includes(j.status));
  const completedJobs = jobs.filter((j) => j.status === 'completed');
  const failedJobs = jobs.filter((j) => j.status === 'failed');

  return (
    <div>
      <div className="p-4 border-b">
        <h3 className="font-semibold">Generation Status</h3>
        <p className="text-sm text-muted-foreground">
          {activeJobs.length} active, {completedJobs.length} completed
        </p>
      </div>

      <Tabs defaultValue="active" className="w-full">
        <TabsList className="w-full grid grid-cols-3">
          <TabsTrigger value="active">
            Active ({activeJobs.length})
          </TabsTrigger>
          <TabsTrigger value="completed">
            Done ({completedJobs.length})
          </TabsTrigger>
          <TabsTrigger value="failed">
            Failed ({failedJobs.length})
          </TabsTrigger>
        </TabsList>

        <ScrollArea className="h-80">
          <TabsContent value="active" className="m-0">
            <JobList jobs={activeJobs} type="active" />
          </TabsContent>

          <TabsContent value="completed" className="m-0">
            <JobList jobs={completedJobs} type="completed" />
          </TabsContent>

          <TabsContent value="failed" className="m-0">
            <JobList jobs={failedJobs} type="failed" />
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  );
}

function JobList({
  jobs,
  type,
}: {
  jobs: GenerationJob[];
  type: 'active' | 'completed' | 'failed';
}) {
  if (jobs.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        {type === 'active' && 'No active generations'}
        {type === 'completed' && 'No recent completions'}
        {type === 'failed' && 'No failed jobs'}
      </div>
    );
  }

  return (
    <div className="divide-y">
      {jobs.map((job) => (
        <JobItem key={job.id} job={job} />
      ))}
    </div>
  );
}

function JobItem({ job }: { job: GenerationJob }) {
  const queryClient = useQueryClient();
  const Icon = JOB_ICONS[job.jobType];

  const cancelMutation = useMutation({
    mutationFn: () => cancelJobAction({ jobId: job.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['generation-status'] });
    },
  });

  const retryMutation = useMutation({
    mutationFn: () => retryJobAction({ jobId: job.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['generation-status'] });
    },
  });

  return (
    <div className="p-4 space-y-2">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium line-clamp-1">{job.name}</p>
            <p className="text-xs text-muted-foreground">{job.projectName}</p>
          </div>
        </div>
        <StatusBadge status={job.status} />
      </div>

      {job.status === 'processing' && (
        <div className="space-y-1">
          <Progress value={job.progress} className="h-1.5" />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{job.progress}%</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2"
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
            >
              <X className="h-3 w-3 mr-1" />
              Cancel
            </Button>
          </div>
        </div>
      )}

      {job.status === 'queued' && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            Queued {formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2"
            onClick={() => cancelMutation.mutate()}
            disabled={cancelMutation.isPending}
          >
            <X className="h-3 w-3 mr-1" />
            Cancel
          </Button>
        </div>
      )}

      {job.status === 'completed' && job.outputUrl && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            Completed {formatDistanceToNow(new Date(job.completedAt!), { addSuffix: true })}
          </span>
          <Button variant="ghost" size="sm" className="h-6 px-2" asChild>
            <a href={job.outputUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3 w-3 mr-1" />
              View
            </a>
          </Button>
        </div>
      )}

      {job.status === 'failed' && (
        <div className="space-y-2">
          <p className="text-xs text-red-600 line-clamp-2">{job.error}</p>
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            onClick={() => retryMutation.mutate()}
            disabled={retryMutation.isPending}
          >
            <RotateCw className="h-3 w-3 mr-1" />
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: GenerationJob['status'] }) {
  const variants = {
    queued: { icon: Clock, label: 'Queued', className: 'bg-slate-100 text-slate-700' },
    processing: { icon: Loader2, label: 'Processing', className: 'bg-blue-100 text-blue-700' },
    completed: { icon: CheckCircle, label: 'Done', className: 'bg-green-100 text-green-700' },
    failed: { icon: XCircle, label: 'Failed', className: 'bg-red-100 text-red-700' },
  };

  const { icon: Icon, label, className } = variants[status];

  return (
    <Badge variant="outline" className={className}>
      <Icon className={`h-3 w-3 mr-1 ${status === 'processing' ? 'animate-spin' : ''}`} />
      {label}
    </Badge>
  );
}
```

### Server Actions

```typescript
// packages/features/film-studio/src/server/generation-status-actions.ts

'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { z } from 'zod';

export const getGenerationStatusAction = enhanceAction(
  async (_, user) => {
    const client = getSupabaseServerClient();

    const { data: jobs } = await client
      .from('generation_jobs')
      .select(`
        id,
        job_type,
        status,
        input_data,
        output_data,
        error_message,
        created_at,
        completed_at,
        projects (name)
      `)
      .eq('account_id', user.accountId)
      .in('status', ['queued', 'processing', 'completed', 'failed'])
      .order('created_at', { ascending: false })
      .limit(50);

    return {
      jobs: jobs?.map((job) => ({
        id: job.id,
        jobType: job.job_type,
        status: job.status,
        progress: job.input_data?.progress || 0,
        name: job.input_data?.name || 'Unnamed job',
        projectName: job.projects?.name || 'Unknown project',
        error: job.error_message,
        createdAt: job.created_at,
        completedAt: job.completed_at,
        outputUrl: job.output_data?.videoUrl || job.output_data?.audioUrl,
      })) || [],
    };
  },
  { auth: true }
);

export const cancelJobAction = enhanceAction(
  async ({ jobId }) => {
    const client = getSupabaseServerClient();

    await client
      .from('generation_jobs')
      .update({ status: 'cancelled' })
      .eq('id', jobId)
      .in('status', ['queued', 'processing']);

    return { success: true };
  },
  {
    schema: z.object({ jobId: z.string().uuid() }),
    auth: true,
  }
);

export const retryJobAction = enhanceAction(
  async ({ jobId }) => {
    const client = getSupabaseServerClient();

    // Get failed job
    const { data: job } = await client
      .from('generation_jobs')
      .select('*')
      .eq('id', jobId)
      .eq('status', 'failed')
      .single();

    if (!job) {
      throw new Error('Job not found or not in failed state');
    }

    // Create new job with same input
    const { data: newJob } = await client
      .from('generation_jobs')
      .insert({
        ...job,
        id: undefined,
        status: 'queued',
        error_message: null,
        retry_count: (job.retry_count || 0) + 1,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    return { success: true, newJobId: newJob.id };
  },
  {
    schema: z.object({ jobId: z.string().uuid() }),
    auth: true,
  }
);
```

### File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/film-studio/src/components/generation-status-indicator.tsx` |
| CREATE | `packages/features/film-studio/src/components/generation-status-panel.tsx` |
| CREATE | `packages/features/film-studio/src/server/generation-status-actions.ts` |

---

## Acceptance Criteria

- [ ] Indicator visible in sidebar/header when jobs active
- [ ] Shows spinning icon when processing
- [ ] Badge shows count of active + queued jobs
- [ ] Panel expands to show job details
- [ ] Real-time progress updates (2s polling when active)
- [ ] Cancel button stops queued/processing jobs
- [ ] Retry button restarts failed jobs
- [ ] View link opens completed output
- [ ] Tabs separate active/completed/failed
- [ ] Empty states for each tab
- [ ] Works in compact mode for sidebar

---

## Test Plan

### Unit Tests
- [ ] Test status badge rendering
- [ ] Test job list filtering

### Integration Tests
- [ ] Test cancel mutation
- [ ] Test retry mutation
- [ ] Test polling interval adjustment

---

## Performance Considerations

- Dynamic polling interval (faster when active)
- Limit to 50 most recent jobs
- Use React Query for background updates
- Optimistic UI for cancel/retry actions
