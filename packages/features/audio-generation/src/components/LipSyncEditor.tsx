'use client';

import * as React from 'react';
import { useCallback, useEffect, useState, useTransition } from 'react';

import {
  AlertCircle,
  Check,
  CheckCircle,
  Clock,
  Loader2,
  Play,
  Video,
  Wand2,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@kit/ui/alert';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Progress } from '@kit/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { toast } from '@kit/ui/sonner';
import { cn } from '@kit/ui/utils';

import type { LipSyncQuality } from '../providers/lip-sync/types';
import {
  applyLipSyncAction,
  generateLipSyncAction,
  getLipSyncJobAction,
  pollLipSyncStatusAction,
} from '../server/lip-sync-actions';
import type { GetLipSyncJobResult } from '../server/lip-sync-actions';

export interface LipSyncDialogueLine {
  id: string;
  text: string;
  audioUrl: string | null;
  status: string;
}

export interface LipSyncEditorProps {
  shotId: string;
  videoUrl: string;
  dialogueLines: LipSyncDialogueLine[];
  onSuccess?: () => void;
  className?: string;
}

type LipSyncStatus =
  | 'queued'
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed';

function LipSyncStatusBadge({ status }: { status: string }) {
  const variants: Record<
    LipSyncStatus,
    {
      variant: 'default' | 'secondary' | 'destructive' | 'outline';
      icon: React.ReactNode;
      label: string;
    }
  > = {
    queued: {
      variant: 'secondary',
      icon: <Clock className="mr-1 h-3 w-3" />,
      label: 'Queued',
    },
    pending: {
      variant: 'secondary',
      icon: <Clock className="mr-1 h-3 w-3" />,
      label: 'Pending',
    },
    processing: {
      variant: 'default',
      icon: <Loader2 className="mr-1 h-3 w-3 animate-spin" />,
      label: 'Processing',
    },
    completed: {
      variant: 'default',
      icon: <CheckCircle className="mr-1 h-3 w-3" />,
      label: 'Complete',
    },
    failed: {
      variant: 'destructive',
      icon: <AlertCircle className="mr-1 h-3 w-3" />,
      label: 'Failed',
    },
  };

  const config = variants[status as LipSyncStatus] ?? variants.pending;

  return (
    <Badge variant={config.variant} className="flex items-center">
      {config.icon}
      {config.label}
    </Badge>
  );
}

export function LipSyncEditor({
  shotId,
  videoUrl,
  dialogueLines,
  onSuccess,
  className,
}: LipSyncEditorProps) {
  const [selectedDialogue, setSelectedDialogue] = useState<string | null>(null);
  const [quality, setQuality] = useState<LipSyncQuality>('standard');
  const [existingJob, setExistingJob] = useState<GetLipSyncJobResult | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();
  const [isPolling, setIsPolling] = useState(false);

  // Filter dialogue lines that have completed audio
  const readyDialogues = dialogueLines.filter(
    (d) => d.status === 'completed' && d.audioUrl,
  );

  // Check if there's a processing job
  const isProcessing =
    existingJob?.status === 'processing' || existingJob?.status === 'pending';
  const isCompleted = existingJob?.status === 'completed';
  const isFailed = existingJob?.status === 'failed';

  // Load existing job on mount
  useEffect(() => {
    const loadExistingJob = async () => {
      try {
        const job = await getLipSyncJobAction({ shotId });
        if (job) {
          setExistingJob(job);
        }
      } catch {
        // No existing job, that's fine
      }
    };
    loadExistingJob();
  }, [shotId]);

  // Poll for status updates when processing
  useEffect(() => {
    if (!isProcessing || !existingJob?.id) return;

    let isMounted = true;
    const jobId = existingJob.id;

    setIsPolling(true);
    const interval = setInterval(async () => {
      try {
        const updated = await pollLipSyncStatusAction({ jobId });

        // Only update state if component is still mounted
        if (!isMounted) return;

        setExistingJob(updated);

        if (updated.status === 'completed' || updated.status === 'failed') {
          clearInterval(interval);
          setIsPolling(false);
        }
      } catch (error) {
        // Only log if still mounted to avoid noise from cleanup
        if (isMounted) {
          console.error('Failed to poll status:', error);
        }
      }
    }, 5000); // Poll every 5 seconds

    return () => {
      isMounted = false;
      clearInterval(interval);
      setIsPolling(false);
    };
  }, [isProcessing, existingJob?.id]);

  const handleGenerate = useCallback(() => {
    if (!selectedDialogue) {
      toast.error('Please select a dialogue line');
      return;
    }

    // Find the selected dialogue and validate it has audio
    const selectedDialogueData = readyDialogues.find(
      (d) => d.id === selectedDialogue,
    );
    if (!selectedDialogueData?.audioUrl) {
      toast.error('Invalid dialogue selection', {
        description: 'The selected dialogue does not have generated audio.',
      });
      return;
    }

    // Capture the validated audioUrl to preserve type narrowing in async closure
    const validatedAudioUrl = selectedDialogueData.audioUrl;

    startTransition(async () => {
      try {
        const result = await generateLipSyncAction({
          shotId,
          dialogueLineId: selectedDialogue,
          quality,
        });

        setExistingJob({
          id: result.jobId,
          shotId,
          dialogueLineId: selectedDialogue,
          provider: 'synclabs',
          status: result.status,
          inputVideoUrl: videoUrl,
          inputAudioUrl: validatedAudioUrl,
          quality,
          providerJobId: result.providerJobId,
          createdAt: new Date().toISOString(),
        });

        toast.success('Lip sync started', {
          description: 'Processing will take a few minutes.',
        });
      } catch (error) {
        toast.error('Lip sync failed', {
          description:
            error instanceof Error ? error.message : 'An error occurred',
        });
      }
    });
  }, [shotId, selectedDialogue, quality, videoUrl, readyDialogues]);

  const handleApply = useCallback(() => {
    if (!existingJob?.id) return;

    startTransition(async () => {
      try {
        await applyLipSyncAction({ jobId: existingJob.id });

        toast.success('Lip sync applied', {
          description: 'The video has been updated with lip sync.',
        });

        onSuccess?.();
      } catch (error) {
        toast.error('Failed to apply lip sync', {
          description:
            error instanceof Error ? error.message : 'An error occurred',
        });
      }
    });
  }, [existingJob?.id, onSuccess]);

  const handlePreview = useCallback(() => {
    if (existingJob?.outputVideoUrl) {
      window.open(existingJob.outputVideoUrl, '_blank');
    }
  }, [existingJob?.outputVideoUrl]);

  return (
    <Card className={cn(className)} data-test="lip-sync-editor">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Video className="h-5 w-5" />
              Lip Sync
            </CardTitle>
            <CardDescription>
              Synchronize character mouth movements with dialogue audio.
            </CardDescription>
          </div>
          {existingJob && <LipSyncStatusBadge status={existingJob.status} />}
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Current Job Status */}
        {existingJob && (
          <div className="space-y-3 rounded-lg bg-muted/50 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Current Job</span>
              <LipSyncStatusBadge status={existingJob.status} />
            </div>

            {/* Progress bar for processing */}
            {isProcessing && (
              <div className="space-y-2">
                <Progress value={existingJob.progress ?? 0} className="h-2" />
                <p className="text-xs text-muted-foreground">
                  {existingJob.progress
                    ? `${existingJob.progress}% complete`
                    : 'Processing...'}
                </p>
              </div>
            )}

            {/* Error message */}
            {isFailed && existingJob.errorMessage && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Processing Failed</AlertTitle>
                <AlertDescription>{existingJob.errorMessage}</AlertDescription>
              </Alert>
            )}

            {/* Actions for completed job */}
            {isCompleted && existingJob.outputVideoUrl && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handlePreview}
                  disabled={isPending}
                >
                  <Play className="mr-1 h-4 w-4" />
                  Preview
                </Button>
                <Button size="sm" onClick={handleApply} disabled={isPending}>
                  {isPending ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="mr-1 h-4 w-4" />
                  )}
                  Apply to Shot
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Dialogue Selection */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Select Dialogue</label>
          <Select
            value={selectedDialogue ?? ''}
            onValueChange={setSelectedDialogue}
            disabled={isPending || isPolling}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose dialogue line..." />
            </SelectTrigger>
            <SelectContent>
              {readyDialogues.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.text.length > 50
                    ? `${d.text.substring(0, 50)}...`
                    : d.text}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {readyDialogues.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Generate dialogue audio first before using lip sync.
            </p>
          )}
        </div>

        {/* Quality Selection */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Quality</label>
          <Select
            value={quality}
            onValueChange={(v) => setQuality(v as LipSyncQuality)}
            disabled={isPending || isPolling}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fast">Fast (~1 min)</SelectItem>
              <SelectItem value="standard">Standard (~2 min)</SelectItem>
              <SelectItem value="high">High Quality (~4 min)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Video Preview */}
        {videoUrl && (
          <div className="space-y-2">
            <label className="text-sm font-medium">Input Video</label>
            <div className="aspect-video overflow-hidden rounded-lg bg-muted">
              <video
                src={videoUrl}
                className="h-full w-full object-contain"
                controls
                preload="metadata"
              />
            </div>
          </div>
        )}

        {/* Generate Button */}
        <Button
          className="w-full"
          onClick={handleGenerate}
          disabled={
            !selectedDialogue ||
            isPending ||
            isPolling ||
            readyDialogues.length === 0
          }
        >
          {isPending || isPolling ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {isPolling ? 'Processing...' : 'Starting...'}
            </>
          ) : (
            <>
              <Wand2 className="mr-2 h-4 w-4" />
              Generate Lip Sync
            </>
          )}
        </Button>

        {/* Info Alert */}
        <Alert>
          <Video className="h-4 w-4" />
          <AlertTitle>How it works</AlertTitle>
          <AlertDescription>
            <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
              <li>Select a dialogue line with generated audio</li>
              <li>Choose quality level (higher = better but slower)</li>
              <li>Generate lip sync to match mouth movements to audio</li>
              <li>Preview the result before applying to the shot</li>
            </ul>
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

LipSyncEditor.displayName = 'LipSyncEditor';
