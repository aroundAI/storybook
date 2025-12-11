# FILM-411: Generation Progress Component

**Phase**: 4
**Priority**: P0
**Effort**: M (3-4 days)
**Dependencies**: FILM-408 (poll-status-action)
**Blocks**: None
**Status**: ✅ Complete
**Completed**: 2025-12-11
**PR**: [#76](https://github.com/aroundAI/storybook/pull/76)

## Implementation Notes

### Files Created
- `packages/features/video-generation/src/components/visual-studio/generation-progress.tsx`
- `packages/features/video-generation/src/components/generation-progress/` (standalone variant)

### Key Implementation Decisions
1. **Polling via generationJobId**: Uses `shot.generationJobId` to call `pollVideoStatusAction` directly
2. **Collapsible UI**: Uses `@kit/ui/collapsible` for expand/collapse of individual shot progress
3. **Smart Fallback**: Falls back to shot data if no generation job ID or on polling error
4. **Status Mapping**: Maps provider statuses (processing/queued/completed/failed) to display statuses
5. **Added to ShotGridShot**: Extended type with `generationJobId` field for polling support

---

## Context

The Generation Progress component displays real-time progress for video generation jobs. It shows queue position, estimated time remaining, progress percentage, and current status for all active generation jobs. The component polls status for generating shots and provides visual feedback to keep users informed during the generation process.

---

## Requirements

### Functional Requirements

1. **Progress Display**
   - Show progress bar with percentage
   - Display estimated time remaining
   - Show queue position if queued
   - Display current status message

2. **Multi-Job Tracking**
   - Track multiple jobs simultaneously
   - Show summary (X of Y completed)
   - Display individual job progress
   - Collapse/expand job details

3. **Real-Time Updates**
   - Poll status every 5 seconds
   - Update progress bars smoothly
   - Show completion notifications
   - Handle errors gracefully

4. **Queue Information**
   - Display queue position
   - Show estimated wait time
   - Update as queue progresses

---

## Interface

### Component Props

```typescript
interface GenerationProgressShot {
  id: string;
  sequenceNumber: number;
  sceneNumber: number;
  shotNumber: number;
  status: 'queued' | 'generating' | 'completed' | 'failed';
  prompt: string | null;
  generationJobId?: string;
}

interface GenerationProgressProps {
  shots: GenerationProgressShot[];
  onCancel?: (shotId: string) => void;
  onComplete?: (shotId: string, videoUrl?: string) => void;
  defaultCollapsed?: boolean;
  className?: string;
}

interface GenerationProgressItemProps {
  shot: GenerationProgressShot;
  status: PollVideoStatusResponse | null;
  isLoading: boolean;
  onCancel?: () => void;
}
```

### Component Implementation

```typescript
'use client';

import { useQueries } from '@tanstack/react-query';
import { pollVideoStatusAction } from '@kit/video-generation/server';
import { Progress } from '@kit/ui/progress';
import { Card } from '@kit/ui/card';

export function GenerationProgress({ shots }: GenerationProgressProps) {
  // Poll status for all generating/queued shots
  const statusQueries = useQueries({
    queries: shots
      .filter((shot) => shot.status === 'queued' || shot.status === 'generating')
      .map((shot) => ({
        queryKey: ['generation-status', shot.id],
        queryFn: async () => {
          // Get generation job ID for shot
          const { data: job } = await supabase
            .from('generation_jobs')
            .select('id')
            .eq('reference_id', shot.id)
            .eq('reference_type', 'shot')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

          if (!job) return null;

          return await pollVideoStatusAction({
            generationJobId: job.id,
          });
        },
        refetchInterval: (data) => {
          // Stop polling when completed/failed
          if (data?.status === 'completed' || data?.status === 'failed') {
            return false;
          }
          return 5000; // Poll every 5 seconds
        },
        enabled: true,
      })),
  });

  const activeJobs = statusQueries.filter((q) => q.data);
  const completedJobs = activeJobs.filter((q) => q.data?.status === 'completed');
  const totalJobs = activeJobs.length;

  if (totalJobs === 0) {
    return null;
  }

  const overallProgress = (completedJobs.length / totalJobs) * 100;

  return (
    <Card className="m-4 p-4">
      <div className="space-y-4">
        {/* Overall Progress */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold">
              Generating Videos ({completedJobs.length} / {totalJobs})
            </h3>
            <span className="text-sm text-gray-600">
              {Math.round(overallProgress)}%
            </span>
          </div>
          <Progress value={overallProgress} />
        </div>

        {/* Individual Job Progress */}
        <div className="space-y-2">
          {statusQueries.map((query, index) => {
            if (!query.data) return null;

            const status = query.data;
            const shot = shots[index];

            return (
              <div
                key={shot.id}
                className="rounded border bg-gray-50 p-3"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium">
                    Shot #{shot.sequence_number}
                  </span>
                  <span className="text-xs text-gray-600">
                    {status.status === 'queued' && 'In queue'}
                    {status.status === 'processing' && 'Generating...'}
                    {status.status === 'completed' && '✓ Complete'}
                    {status.status === 'failed' && '✗ Failed'}
                  </span>
                </div>

                {status.status === 'processing' && (
                  <>
                    <Progress value={status.progress || 0} />
                    <div className="mt-1 flex justify-between text-xs text-gray-600">
                      <span>{status.progress || 0}%</span>
                      {status.estimatedTimeRemaining && (
                        <span>
                          ~{Math.ceil(status.estimatedTimeRemaining / 60)}m remaining
                        </span>
                      )}
                    </div>
                  </>
                )}

                {status.status === 'queued' && status.queuePosition && (
                  <p className="text-xs text-gray-600">
                    Position in queue: {status.queuePosition}
                  </p>
                )}

                {status.status === 'failed' && status.errorMessage && (
                  <p className="text-xs text-red-600">
                    Error: {status.errorMessage}
                  </p>
                )}

                <p className="mt-1 line-clamp-1 text-xs text-gray-500">
                  {shot.prompt}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
```

---

## Implementation Details

### File Structure

```
packages/features/video-generation/src/
├── components/
│   ├── generation-progress/
│   │   ├── index.ts                        # Barrel export
│   │   ├── generation-progress.tsx         # Main component
│   │   ├── generation-progress-item.tsx    # Individual shot progress
│   │   └── types.ts                        # TypeScript interfaces
│   └── index.ts                            # Updated with GenerationProgress export
├── hooks/
│   └── use-generation-status.ts            # React Query hook for polling
└── server/
    └── actions/
        └── get-shot-generation-job-action.ts  # Lookup job ID for shot
```

### Polling Strategy

```typescript
// React Query polling configuration - stops on all terminal states
{
  refetchInterval: (query) => {
    const data = query.state.data;
    // Stop polling when job reaches a terminal state
    if (
      data?.status === 'completed' ||
      data?.status === 'failed' ||
      data?.status === 'cancelled'
    ) {
      return false;
    }
    return 5000; // Poll every 5 seconds
  },
  staleTime: 5000,
}
```

### Progress Calculation

```typescript
// Overall progress: percentage of completed jobs
const overallProgress = (completedJobs.length / totalJobs) * 100;

// Individual progress: from provider API
const individualProgress = status.progress || 0;

// Estimated time remaining: from provider or calculated
const estimatedTime = status.estimatedTimeRemaining || null;
```

---

## File Changes

### New Files

1. **packages/features/video-generation/src/components/generation-progress/generation-progress.tsx** - Main collapsible component
2. **packages/features/video-generation/src/components/generation-progress/generation-progress-item.tsx** - Individual shot progress display
3. **packages/features/video-generation/src/components/generation-progress/types.ts** - TypeScript interfaces
4. **packages/features/video-generation/src/components/generation-progress/index.ts** - Barrel export
5. **packages/features/video-generation/src/hooks/use-generation-status.ts** - React Query hook with parallel polling
6. **packages/features/video-generation/src/server/actions/get-shot-generation-job-action.ts** - Server action to lookup job ID

### Modified Files

1. **packages/features/video-generation/src/components/index.ts** - Added GenerationProgress exports
2. **packages/features/video-generation/src/hooks/index.ts** - Added useGenerationStatus export
3. **packages/features/video-generation/src/server/actions/index.ts** - Added getShotGenerationJobAction export
4. **packages/features/video-generation/package.json** - Added @tanstack/react-query dependency

---

## Acceptance Criteria

- [x] Component displays overall progress
  - ✅ `overallProgress` calculated from completed/total, shown in Progress bar
- [x] Component shows individual job progress
  - ✅ `ShotProgressItem` component renders each shot with status
- [x] Component polls status every 5 seconds
  - ✅ `refetchInterval: 5000` in useQueries config
- [x] Component stops polling when complete (including cancelled state)
  - ✅ Returns `false` when status is 'completed', 'failed', or 'cancelled'
- [x] Component displays queue position
  - ✅ UI supports queue position display, data pending API enhancement
- [x] Component shows estimated time
  - ✅ UI supports estimated time display, data pending API enhancement
- [x] Component handles errors gracefully
  - ✅ Try/catch in queryFn falls back to shot data on error
- [x] Component is accessible
  - ✅ Uses semantic @kit/ui components, status icons have labels
- [x] Cancel button integrated with cancelVideoJobAction
- [x] Collapsible design for compact view
- [x] Completion notifications via onComplete callback (with deduplication)

---

## Test Plan

### Unit Tests

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { GenerationProgress } from '../GenerationProgress';

describe('GenerationProgress', () => {
  it('should display overall progress', () => {
    const shots = [
      { id: '1', status: 'generating', /* ... */ },
      { id: '2', status: 'generating', /* ... */ },
    ];

    render(<GenerationProgress shots={shots} />);

    expect(screen.getByText(/Generating Videos/)).toBeInTheDocument();
  });

  it('should poll status every 5 seconds', async () => {
    const mockPoll = vi.fn();
    vi.mocked(pollVideoStatusAction).mockImplementation(mockPoll);

    render(<GenerationProgress shots={[/* ... */]} />);

    await waitFor(() => {
      expect(mockPoll).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(mockPoll).toHaveBeenCalledTimes(2);
    }, { timeout: 6000 });
  });

  it('should stop polling when completed', async () => {
    vi.mocked(pollVideoStatusAction).mockResolvedValue({
      status: 'completed',
      progress: 100,
    });

    render(<GenerationProgress shots={[/* ... */]} />);

    // Poll should stop
    await waitFor(() => {
      expect(screen.getByText('✓ Complete')).toBeInTheDocument();
    });
  });
});
```

---

## Accessibility

- Progress bars have proper ARIA attributes
- Screen reader announcements for status changes
- Visual and text indicators for all states
- Keyboard accessible (if interactive)

```typescript
<Progress
  value={progress}
  aria-label={`Shot ${sequenceNumber} generation progress`}
  aria-valuenow={progress}
  aria-valuemin={0}
  aria-valuemax={100}
/>
```

---

## Performance Considerations

- Use React Query for efficient polling
- Batch status polls if possible
- Debounce progress bar updates
- Optimize re-renders with React.memo

---

## Future Enhancements

1. ~~**Cancel Button** - Allow canceling jobs~~ (Implemented)
2. ~~**Completion Callbacks** - Notify parent on job completion~~ (Implemented)
3. **Detailed Timeline** - Show step-by-step progress
4. **Notifications** - Browser notifications on completion
5. **History** - View past generation jobs

---

## Implementation Notes

### Key Design Decisions

1. **useEffect for completion notifications**: Side effects (calling onComplete) are handled in useEffect rather than during render to avoid React anti-patterns and duplicate notifications.

2. **Ref-based deduplication**: A `useRef<Set<string>>` tracks which shots have been notified to prevent duplicate onComplete callbacks.

3. **Terminal state handling**: Polling stops on all terminal states: `completed`, `failed`, and `cancelled`.

4. **Server action for job lookup**: Created `getShotGenerationJobAction` to encapsulate the database query for finding job IDs, rather than querying directly in the component.

5. **Collapsible via Radix UI**: Uses `@kit/ui/collapsible` for accessible expand/collapse behavior.

### UI Components Used

- `@kit/ui/progress` - Progress bars
- `@kit/ui/card` - Card container (Card, CardHeader, CardContent, CardTitle)
- `@kit/ui/badge` - Status badges with variants
- `@kit/ui/button` - Cancel and collapse buttons
- `@kit/ui/collapsible` - Collapsible sections
- `lucide-react` - Icons (Loader2, Check, X, Clock, AlertCircle, ChevronUp, ChevronDown)

---

## References

- **FILM-408**: Poll status action
- **React Query Polling**: https://tanstack.com/query/latest/docs/guides/polling
- **@kit/ui Progress**: Internal UI component
- **Constitution**: Section 8 (Accessibility)
- **PR #72**: https://github.com/aroundAI/storybook/pull/72
- **PR #76**: https://github.com/aroundAI/storybook/pull/76
