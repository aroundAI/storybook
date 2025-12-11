'use client';

import * as React from 'react';
import { useCallback, useState, useTransition } from 'react';

import {
  AlertCircle,
  CheckCircle,
  Clock,
  Loader2,
  Mic,
  Trash2,
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
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import { toast } from '@kit/ui/sonner';
import { Textarea } from '@kit/ui/textarea';
import { cn } from '@kit/ui/utils';

import type {
  CloneStatusType,
  VoiceCloneConsentSchemaType,
} from '../lib/schemas';
import {
  deleteVoiceCloneAction,
  startVoiceCloneAction,
} from '../server/voice-clone-actions';
import type { AudioSample } from './AudioUploader';
import { AudioUploader } from './AudioUploader';
import { ConsentDialog } from './ConsentDialog';

export interface VoiceProfile {
  asset_id: string;
  provider?: string | null;
  provider_voice_id?: string | null;
  clone_status?: CloneStatusType | null;
  clone_samples?: string[] | null;
  clone_metadata?: Record<string, unknown> | null;
}

export interface VoiceCloningEditorProps {
  assetId: string;
  projectId: string;
  existingProfile?: VoiceProfile | null;
  onUploadSample?: (file: File) => Promise<string>;
  onSuccess?: () => void;
  className?: string;
}

function CloneStatusBadge({ status }: { status: CloneStatusType | null }) {
  if (!status) return null;

  const variants: Record<
    CloneStatusType,
    {
      variant: 'default' | 'secondary' | 'destructive' | 'outline';
      icon: React.ReactNode;
      label: string;
    }
  > = {
    pending: {
      variant: 'secondary',
      icon: <Clock className="mr-1 h-3 w-3" />,
      label: 'Pending',
    },
    training: {
      variant: 'default',
      icon: <Loader2 className="mr-1 h-3 w-3 animate-spin" />,
      label: 'Training',
    },
    ready: {
      variant: 'default',
      icon: <CheckCircle className="mr-1 h-3 w-3" />,
      label: 'Ready',
    },
    failed: {
      variant: 'destructive',
      icon: <AlertCircle className="mr-1 h-3 w-3" />,
      label: 'Failed',
    },
  };

  const config = variants[status];

  return (
    <Badge variant={config.variant} className="flex items-center">
      {config.icon}
      {config.label}
    </Badge>
  );
}

export function VoiceCloningEditor({
  assetId,
  projectId: _projectId,
  existingProfile,
  onUploadSample,
  onSuccess,
  className,
}: VoiceCloningEditorProps) {
  const [samples, setSamples] = useState<AudioSample[]>([]);
  const [voiceName, setVoiceName] = useState('');
  const [description, setDescription] = useState('');
  const [showConsent, setShowConsent] = useState(false);
  const [isPending, startTransition] = useTransition();

  const hasExistingClone = !!existingProfile?.provider_voice_id;
  const cloneStatus = existingProfile?.clone_status;
  const isCloning = cloneStatus === 'pending' || cloneStatus === 'training';

  const totalDuration = samples.reduce((sum, s) => sum + (s.duration || 0), 0);
  const hasMinDuration = totalDuration >= 60;
  const hasValidSamples = samples.some((s) => s.url && !s.error);
  const isReadyToClone =
    hasMinDuration &&
    hasValidSamples &&
    voiceName.trim().length > 0 &&
    !isPending &&
    !isCloning;

  const handleStartClone = useCallback(() => {
    if (!isReadyToClone) return;
    setShowConsent(true);
  }, [isReadyToClone]);

  const handleConsent = useCallback(
    (consent: VoiceCloneConsentSchemaType) => {
      setShowConsent(false);

      startTransition(async () => {
        try {
          const sampleUrls = samples
            .filter((s) => s.url && !s.error)
            .map((s) => s.url);

          const result = await startVoiceCloneAction({
            assetId,
            voiceName: voiceName.trim(),
            description: description.trim() || undefined,
            samples: sampleUrls,
            consent,
          });

          if (result.success) {
            toast.success('Voice cloning started', {
              description: 'Your voice clone is being processed.',
            });
            onSuccess?.();
          }
        } catch (error) {
          toast.error('Voice cloning failed', {
            description:
              error instanceof Error ? error.message : 'An error occurred',
          });
        }
      });
    },
    [assetId, voiceName, description, samples, onSuccess],
  );

  const handleDeleteClone = useCallback(() => {
    startTransition(async () => {
      try {
        const result = await deleteVoiceCloneAction({ assetId });

        if (result.success) {
          toast.success('Voice clone deleted', {
            description: 'The cloned voice has been removed.',
          });
          setSamples([]);
          setVoiceName('');
          setDescription('');
          onSuccess?.();
        }
      } catch (error) {
        toast.error('Failed to delete voice clone', {
          description:
            error instanceof Error ? error.message : 'An error occurred',
        });
      }
    });
  }, [assetId, onSuccess]);

  return (
    <Card className={cn(className)} data-test="voice-cloning-editor">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Mic className="h-5 w-5" />
              Voice Cloning
            </CardTitle>
            <CardDescription>
              Upload voice samples to create a custom AI voice clone.
            </CardDescription>
          </div>
          {cloneStatus && <CloneStatusBadge status={cloneStatus} />}
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Existing clone info */}
        {hasExistingClone && cloneStatus === 'ready' && (
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertTitle>Voice Clone Active</AlertTitle>
            <AlertDescription className="flex items-center justify-between">
              <span>
                Your cloned voice is ready to use for dialogue generation.
              </span>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteClone}
                disabled={isPending}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Clone
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Clone failed */}
        {cloneStatus === 'failed' && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Voice Cloning Failed</AlertTitle>
            <AlertDescription>
              {(existingProfile?.clone_metadata?.error as string) ||
                'An error occurred during voice cloning. Please try again.'}
            </AlertDescription>
          </Alert>
        )}

        {/* Voice name and description */}
        {!hasExistingClone && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="voiceName">Voice Name</Label>
              <Input
                id="voiceName"
                placeholder="e.g., Character Voice"
                value={voiceName}
                onChange={(e) => setVoiceName(e.target.value)}
                maxLength={100}
                disabled={isPending || isCloning}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="voiceDescription">Description (Optional)</Label>
              <Textarea
                id="voiceDescription"
                placeholder="Describe the voice characteristics..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
                disabled={isPending || isCloning}
                className="min-h-[80px]"
              />
            </div>
          </div>
        )}

        {/* Sample Upload */}
        {!hasExistingClone && (
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-medium">Voice Samples</h4>
              <p className="text-muted-foreground text-sm">
                Upload at least 1 minute of clear audio. More samples improve
                quality.
              </p>
            </div>
            <AudioUploader
              value={samples}
              onChange={setSamples}
              maxSamples={25}
              minTotalDuration={60}
              onUpload={onUploadSample}
              disabled={isPending || isCloning}
            />
          </div>
        )}

        {/* Quality Guidelines */}
        {!hasExistingClone && (
          <Alert>
            <Mic className="h-4 w-4" />
            <AlertTitle>Recording Tips</AlertTitle>
            <AlertDescription>
              <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
                <li>Use clear, noise-free audio recordings</li>
                <li>Include varied speech (questions, statements, emotions)</li>
                <li>Avoid background music or multiple speakers</li>
                <li>Record in a consistent, quiet environment</li>
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {/* Actions */}
        {!hasExistingClone && (
          <div className="flex justify-end gap-3">
            <Button
              onClick={handleStartClone}
              disabled={!isReadyToClone}
              data-test="start-clone-button"
            >
              {isPending || isCloning ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                'Start Voice Clone'
              )}
            </Button>
          </div>
        )}

        {/* Consent Dialog */}
        <ConsentDialog
          open={showConsent}
          onOpenChange={setShowConsent}
          onConsent={handleConsent}
          isLoading={isPending}
        />
      </CardContent>
    </Card>
  );
}

VoiceCloningEditor.displayName = 'VoiceCloningEditor';
