# FILM-409: Visual Studio Component

**Phase**: 4
**Priority**: P0
**Effort**: L (6-7 days)
**Dependencies**: FILM-405 (generate-video-action)
**Blocks**: None

---

## Context

The Visual Studio is the main workspace for video generation. It displays the shot grid, generation controls, timeline preview, and real-time status updates. Users can select shots, trigger generation, monitor progress, and preview generated videos. The component must handle complex state management, real-time updates, and provide an intuitive UX for managing dozens of shots.

---

## Requirements

### Functional Requirements

1. **Shot Grid Display**
   - Display all shots in grid layout
   - Show thumbnail/video preview
   - Display generation status (queued/processing/completed/failed)
   - Support shot selection (single/multiple)

2. **Generation Controls**
   - Generate button for selected shots
   - Provider selection dropdown
   - Quality mode toggle (standard/pro)
   - Batch operations (generate all, cancel all)

3. **Real-Time Updates**
   - Subscribe to shot updates via Supabase Realtime
   - Update shot status in real-time
   - Show progress bars for generating shots
   - Display notifications on completion

4. **Timeline View**
   - Show shots in chronological order
   - Drag-and-drop reordering
   - Play preview of episode
   - Export timeline

---

## Interface

### Component Props

```typescript
interface VisualStudioProps {
  episodeId: string;
  projectId: string;
}
```

### Component Implementation

```typescript
'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@kit/supabase/client';
import { generateVideoAction, batchGenerateVideosAction } from '@kit/video-generation/server';
import { toast } from '@kit/ui/sonner';
import { ShotGrid } from './ShotGrid';
import { GenerationProgress } from './GenerationProgress';
import { Button } from '@kit/ui/button';
import { Select } from '@kit/ui/select';

export function VisualStudio({ episodeId, projectId }: VisualStudioProps) {
  const queryClient = useQueryClient();
  const supabase = createClient();

  const [selectedShotIds, setSelectedShotIds] = useState<string[]>([]);
  const [provider, setProvider] = useState<'kling' | 'runway' | 'luma'>('kling');
  const [mode, setMode] = useState<'std' | 'pro'>('std');

  // Fetch shots
  const { data: shots, isLoading } = useQuery({
    queryKey: ['shots', episodeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shots')
        .select('*')
        .eq('episode_id', episodeId)
        .order('sequence_number');

      if (error) throw error;
      return data;
    },
  });

  // Subscribe to shot updates
  useEffect(() => {
    const channel = supabase
      .channel(`shots:episode:${episodeId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'shots',
          filter: `episode_id=eq.${episodeId}`,
        },
        (payload) => {
          // Invalidate shots query to refetch
          queryClient.invalidateQueries({ queryKey: ['shots', episodeId] });

          // Show notification on completion
          if (payload.new?.status === 'completed') {
            toast.success('Video generation completed!');
          } else if (payload.new?.status === 'failed') {
            toast.error('Video generation failed');
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [episodeId, supabase, queryClient]);

  // Generate videos mutation
  const generateMutation = useMutation({
    mutationFn: async () => {
      if (selectedShotIds.length === 0) {
        throw new Error('No shots selected');
      }

      if (selectedShotIds.length === 1) {
        return await generateVideoAction({
          shotId: selectedShotIds[0],
          provider,
          mode,
        });
      } else {
        return await batchGenerateVideosAction({
          shotIds: selectedShotIds,
          provider,
          mode,
        });
      }
    },
    onSuccess: () => {
      toast.success(`Generating ${selectedShotIds.length} video(s)`);
      setSelectedShotIds([]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Generation failed');
    },
  });

  const handleGenerateSelected = () => {
    generateMutation.mutate();
  };

  const handleSelectAll = () => {
    const allShotIds = shots?.map((s) => s.id) || [];
    setSelectedShotIds(allShotIds);
  };

  const handleDeselectAll = () => {
    setSelectedShotIds([]);
  };

  if (isLoading) {
    return <div>Loading shots...</div>;
  }

  const selectedShots = shots?.filter((s) => selectedShotIds.includes(s.id)) || [];
  const processingShots = shots?.filter((s) =>
    s.status === 'generating' || s.status === 'queued'
  ) || [];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="text-2xl font-semibold">Visual Studio</h2>

        <div className="flex items-center gap-4">
          {/* Provider Selection */}
          <Select value={provider} onValueChange={setProvider as any}>
            <option value="kling">Kling AI</option>
            <option value="runway">Runway</option>
            <option value="luma">Luma</option>
          </Select>

          {/* Quality Mode */}
          <Select value={mode} onValueChange={setMode as any}>
            <option value="std">Standard</option>
            <option value="pro">Professional</option>
          </Select>

          {/* Actions */}
          <Button
            variant="secondary"
            onClick={handleSelectAll}
            disabled={shots?.length === selectedShotIds.length}
          >
            Select All
          </Button>

          <Button
            variant="secondary"
            onClick={handleDeselectAll}
            disabled={selectedShotIds.length === 0}
          >
            Deselect All
          </Button>

          <Button
            onClick={handleGenerateSelected}
            disabled={selectedShotIds.length === 0 || generateMutation.isPending}
          >
            Generate ({selectedShotIds.length})
          </Button>
        </div>
      </div>

      {/* Progress Bar */}
      {processingShots.length > 0 && (
        <GenerationProgress shots={processingShots} />
      )}

      {/* Shot Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        <ShotGrid
          shots={shots || []}
          selectedShotIds={selectedShotIds}
          onSelectionChange={setSelectedShotIds}
        />
      </div>
    </div>
  );
}
```

---

## Implementation Details

### File Structure

```
packages/features/video-generation/src/
├── components/
│   ├── VisualStudio.tsx                # Main component (CREATE THIS)
│   ├── ShotGrid.tsx                    # Grid view (FILM-410)
│   ├── GenerationProgress.tsx          # Progress display (FILM-411)
│   └── __tests__/
│       └── VisualStudio.test.tsx
```

### State Management

```typescript
// Component State
- selectedShotIds: string[]          // Currently selected shots
- provider: VideoProvider            // Selected provider
- mode: 'std' | 'pro'               // Quality mode
- shots: Shot[]                     // All shots (from React Query)

// Real-time Updates
- Supabase Realtime subscription
- Automatic cache invalidation
- Toast notifications on status change
```

### Real-Time Integration

```typescript
// Subscribe to shot changes
supabase
  .channel(`shots:episode:${episodeId}`)
  .on('postgres_changes', { /* config */ }, (payload) => {
    // Handle shot updates
    queryClient.invalidateQueries(['shots', episodeId]);
  })
  .subscribe();
```

---

## File Changes

### New Files

1. **packages/features/video-generation/src/components/VisualStudio.tsx**
2. **packages/features/video-generation/src/components/__tests__/VisualStudio.test.tsx**

### Modified Files

1. **packages/features/video-generation/src/components/index.ts** - Export component

---

## Acceptance Criteria

- [ ] Component displays all shots in grid
- [ ] Component supports shot selection
- [ ] Component triggers video generation
- [ ] Component shows real-time status updates
- [ ] Component displays progress for generating shots
- [ ] Component handles errors gracefully
- [ ] Component is keyboard accessible
- [ ] Component works on mobile (responsive)

---

## Test Plan

### Unit Tests

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VisualStudio } from '../VisualStudio';

describe('VisualStudio', () => {
  it('should render shot grid', () => {
    render(<VisualStudio episodeId="episode-123" projectId="project-123" />);
    expect(screen.getByText('Visual Studio')).toBeInTheDocument();
  });

  it('should allow selecting shots', async () => {
    render(<VisualStudio episodeId="episode-123" projectId="project-123" />);

    const selectButton = screen.getByText('Select All');
    fireEvent.click(selectButton);

    // Verify shots selected
    expect(screen.getByText(/Generate \(\d+\)/)).toBeInTheDocument();
  });

  it('should trigger video generation', async () => {
    const mockGenerate = vi.fn();
    vi.mocked(generateVideoAction).mockImplementation(mockGenerate);

    render(<VisualStudio episodeId="episode-123" projectId="project-123" />);

    // Select shot and generate
    // Assert mockGenerate called
  });
});
```

---

## Security Considerations

- Verify user has access to episode/project
- Validate shot selection client-side
- Check RLS policies on all queries
- Sanitize shot data before display

---

## Accessibility

- Keyboard navigation for shot grid
- Screen reader announcements for status changes
- Focus management during generation
- ARIA labels for all controls

---

## Performance Considerations

- Virtualize shot grid for >100 shots
- Debounce selection changes
- Optimize Realtime subscriptions
- Use React Query cache efficiently

---

## Future Enhancements

1. **Timeline View** - Chronological shot ordering
2. **Video Preview** - In-line video player
3. **Bulk Editing** - Edit multiple shots at once
4. **Export** - Export episode as video file

---

## References

- **FILM-410**: ShotGrid component
- **FILM-411**: GenerationProgress component
- **FILM-405**: Generate video action
- **Constitution**: Section 2.3 (Component Pattern)
