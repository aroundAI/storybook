'use client';

import { useCallback, useMemo, useState } from 'react';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Film, Loader2 } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@kit/ui/alert';
import { Card, CardContent } from '@kit/ui/card';
import { toast } from '@kit/ui/sonner';
import { cn } from '@kit/ui/utils';

import { useShotsQuery } from '../../hooks/use-shots-query';
import { useShotsRealtime } from '../../hooks/use-shots-realtime';
import type { VideoProvider } from '../../lib/types';
import {
  type BatchGenerateResponse,
  type GenerateVideoResponse,
  batchGenerateVideosAction,
  generateVideoAction,
} from '../../server/actions';
import { ShotGrid } from '../shot-grid';
import { GenerationProgress } from './generation-progress';
import type { QualityMode, VisualStudioProps } from './types';
import { VisualStudioHeader } from './visual-studio-header';

/**
 * UI state for the Visual Studio component
 */
interface VisualStudioState {
  selectedShotIds: string[];
  provider: VideoProvider;
  mode: QualityMode;
}

/**
 * VisualStudio is the main workspace for video generation.
 *
 * Features:
 * - Displays all shots in a responsive grid
 * - Supports shot selection (single and multi-select with Ctrl/Cmd+Click)
 * - Provider selection (Kling, Runway, Luma, Hailuo)
 * - Quality mode toggle (Standard/Professional)
 * - Batch video generation for selected shots
 * - Real-time status updates via Supabase Realtime
 * - Progress tracking for generating shots
 */
export function VisualStudio({
  episodeId,
  projectId: _projectId,
}: VisualStudioProps) {
  const queryClient = useQueryClient();

  // Consolidated UI state (per CLAUDE.md: prefer single state object)
  const [state, setState] = useState<VisualStudioState>({
    selectedShotIds: [],
    provider: 'kling',
    mode: 'std',
  });

  // Fetch shots data
  const { data: shots, isLoading, error, refetch } = useShotsQuery(episodeId);

  // Subscribe to real-time updates
  useShotsRealtime({
    episodeId,
    enabled: true,
    showNotifications: true,
  });

  // Generate videos mutation - accepts shotIds as parameter to avoid stale closure issues
  const generateMutation = useMutation<
    GenerateVideoResponse | BatchGenerateResponse,
    Error,
    { shotIds: string[] }
  >({
    mutationFn: async ({ shotIds }) => {
      if (shotIds.length === 0) {
        throw new Error('No shots selected');
      }

      const firstShotId = shotIds[0];
      if (!firstShotId) {
        throw new Error('No shot ID available');
      }

      if (shotIds.length === 1) {
        return generateVideoAction({
          shotId: firstShotId,
          provider: state.provider,
          mode: state.mode,
        });
      } else {
        return batchGenerateVideosAction({
          shotIds,
          provider: state.provider,
          mode: state.mode,
          priority: 'normal',
        });
      }
    },
    onSuccess: (result: GenerateVideoResponse | BatchGenerateResponse) => {
      if ('successCount' in result) {
        // Batch result
        const batchResult = result as BatchGenerateResponse;
        toast.success(
          `Started generating ${batchResult.successCount} video${batchResult.successCount !== 1 ? 's' : ''}`,
          {
            description:
              batchResult.failureCount > 0
                ? `${batchResult.failureCount} failed to start`
                : undefined,
          },
        );
      } else {
        // Single result
        toast.success('Video generation started');
      }

      // Clear selection after successful generation
      setState((prev) => ({ ...prev, selectedShotIds: [] }));

      // Invalidate shots query to refetch updated statuses
      queryClient.invalidateQueries({ queryKey: ['shots', episodeId] });
    },
    onError: (error: Error) => {
      toast.error('Failed to start generation', {
        description: error.message || 'Unknown error',
      });
    },
  });

  // Selection handlers
  const handleSelectAll = useCallback(() => {
    if (shots) {
      setState((prev) => ({
        ...prev,
        selectedShotIds: shots.map((s) => s.id),
      }));
    }
  }, [shots]);

  const handleDeselectAll = useCallback(() => {
    setState((prev) => ({ ...prev, selectedShotIds: [] }));
  }, []);

  const handleGenerate = useCallback(() => {
    generateMutation.mutate({ shotIds: state.selectedShotIds });
  }, [generateMutation, state.selectedShotIds]);

  // Shot grid callbacks
  const handleShotPreview = useCallback((_shotId: string) => {
    // Preview modal implementation pending - will be added in future PR
  }, []);

  const handleGenerateShot = useCallback(
    (shotId: string) => {
      // Single shot quick generate - pass shotId directly to avoid stale state
      generateMutation.mutate({ shotIds: [shotId] });
    },
    [generateMutation],
  );

  const handleRetryShot = useCallback(
    (shotId: string) => {
      // Retry failed shot - pass shotId directly to avoid stale state
      generateMutation.mutate({ shotIds: [shotId] });
    },
    [generateMutation],
  );

  const handleReorder = useCallback((_shotId: string, _newSequence: number) => {
    // Reordering implementation pending - will be added in future PR
  }, []);

  // Memoized processing shots for progress component
  const processingShots = useMemo(
    () =>
      shots?.filter(
        (s) => s.status === 'queued' || s.status === 'generating',
      ) ?? [],
    [shots],
  );

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-16">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
            <p className="text-muted-foreground text-sm">Loading shots...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Failed to load shots</AlertTitle>
        <AlertDescription>
          {error instanceof Error ? error.message : 'An error occurred'}
          <button
            onClick={() => refetch()}
            className="ml-2 underline hover:no-underline"
          >
            Try again
          </button>
        </AlertDescription>
      </Alert>
    );
  }

  // Empty state
  if (!shots || shots.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16">
          <div className="bg-muted mb-4 flex h-16 w-16 items-center justify-center rounded-full">
            <Film className="text-muted-foreground h-8 w-8" />
          </div>
          <h3 className="mb-2 text-lg font-semibold">No shots yet</h3>
          <p className="text-muted-foreground max-w-sm text-center text-sm">
            Generate a shot list from your screenplay in the Story Studio to see
            shots here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header with controls */}
      <VisualStudioHeader
        selectedShotIds={state.selectedShotIds}
        totalShots={shots.length}
        provider={state.provider}
        mode={state.mode}
        onProviderChange={(provider) =>
          setState((prev) => ({ ...prev, provider }))
        }
        onModeChange={(mode) => setState((prev) => ({ ...prev, mode }))}
        onSelectAll={handleSelectAll}
        onDeselectAll={handleDeselectAll}
        onGenerate={handleGenerate}
        isGenerating={generateMutation.isPending}
      />

      {/* Generation Progress Panel */}
      {processingShots.length > 0 && (
        <GenerationProgress shots={shots} episodeId={episodeId} />
      )}

      {/* Shot Grid */}
      <div className={cn('flex-1 overflow-y-auto p-4')}>
        <ShotGrid
          shots={shots}
          selectedShotIds={state.selectedShotIds}
          onSelectionChange={(selectedShotIds) =>
            setState((prev) => ({ ...prev, selectedShotIds }))
          }
          onShotPreview={handleShotPreview}
          onGenerateShot={handleGenerateShot}
          onRetryShot={handleRetryShot}
          onReorder={handleReorder}
          enableReorder={true}
        />
      </div>
    </div>
  );
}
