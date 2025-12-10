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

  // Local state
  const [selectedShotIds, setSelectedShotIds] = useState<string[]>([]);
  const [provider, setProvider] = useState<VideoProvider>('kling');
  const [mode, setMode] = useState<QualityMode>('std');

  // Fetch shots data
  const { data: shots, isLoading, error, refetch } = useShotsQuery(episodeId);

  // Subscribe to real-time updates
  useShotsRealtime({
    episodeId,
    enabled: true,
    showNotifications: true,
  });

  // Generate videos mutation
  const generateMutation = useMutation<
    GenerateVideoResponse | BatchGenerateResponse,
    Error
  >({
    mutationFn: async () => {
      if (selectedShotIds.length === 0) {
        throw new Error('No shots selected');
      }

      const shotId = selectedShotIds[0];
      if (!shotId) {
        throw new Error('No shot ID available');
      }

      if (selectedShotIds.length === 1) {
        return generateVideoAction({
          shotId,
          provider,
          mode,
        });
      } else {
        return batchGenerateVideosAction({
          shotIds: selectedShotIds,
          provider,
          mode,
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
      setSelectedShotIds([]);

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
      setSelectedShotIds(shots.map((s) => s.id));
    }
  }, [shots]);

  const handleDeselectAll = useCallback(() => {
    setSelectedShotIds([]);
  }, []);

  const handleGenerate = useCallback(() => {
    generateMutation.mutate();
  }, [generateMutation]);

  // Shot grid callbacks
  const handleShotPreview = useCallback((shotId: string) => {
    // TODO: Open preview modal for shot
    console.log('Preview shot:', shotId);
  }, []);

  const handleGenerateShot = useCallback(
    (shotId: string) => {
      // Single shot quick generate
      setSelectedShotIds([shotId]);
      generateMutation.mutate();
    },
    [generateMutation],
  );

  const handleRetryShot = useCallback(
    (shotId: string) => {
      // Retry failed shot
      setSelectedShotIds([shotId]);
      generateMutation.mutate();
    },
    [generateMutation],
  );

  const handleReorder = useCallback((shotId: string, newSequence: number) => {
    // TODO: Implement shot reordering server action
    console.log('Reorder shot:', shotId, 'to sequence:', newSequence);
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
        selectedShotIds={selectedShotIds}
        totalShots={shots.length}
        provider={provider}
        mode={mode}
        onProviderChange={setProvider}
        onModeChange={setMode}
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
          selectedShotIds={selectedShotIds}
          onSelectionChange={setSelectedShotIds}
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
