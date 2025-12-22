'use client';

import { useCallback, useState } from 'react';

import { useRouter } from 'next/navigation';

import {
    AlertCircle,
    Check,
    CheckCircle2,
    Download,
    Film,
    Loader2,
    Mic,
    Music,
    Settings2,
    Volume2,
    X,
} from 'lucide-react';

import type { CharacterAsset, DialogueLine } from '@kit/audio-generation/lib';
import { autoStitchAction, renderVideoAction } from '@kit/episodes/server';
import type { EpisodeWithShots, Shot } from '@kit/episodes/types';
import { Button } from '@kit/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@kit/ui/dialog';
import { toast } from '@kit/ui/sonner';

interface MusicTrackData {
    id: string;
    name: string | null;
    fileUrl: string | null;
    durationSeconds: number | null;
    timelineStartSeconds: number;
    status: 'pending' | 'processing' | 'completed' | 'failed';
}

interface FinalizeDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    episode: EpisodeWithShots;
    completedShots: Shot[];
    dialogueLines: DialogueLine[];
    characters: CharacterAsset[];
    musicTracks: MusicTrackData[];
    accountSlug: string;
    onComplete: () => void;
}

type ExportStep = 'preflight' | 'stitching' | 'exporting' | 'complete' | 'error';

export function FinalizeDialog({
    open,
    onOpenChange,
    episode,
    completedShots,
    dialogueLines,
    musicTracks,
    accountSlug,
    onComplete,
}: FinalizeDialogProps) {
    const router = useRouter();
    const [currentStep, setCurrentStep] = useState<ExportStep>('preflight');
    const [error, setError] = useState<string | null>(null);
    const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);
    const [dialogueVolume, setDialogueVolume] = useState(1.0);
    const [musicVolume, setMusicVolume] = useState(0.3);

    // Calculate pre-flight checks
    const preflightChecks = {
        hasShots: completedShots.length > 0,
        allShotsComplete: completedShots.every((s) => s.videoUrl),
        hasDialogue: dialogueLines.length > 0,
        dialogueComplete: dialogueLines.filter((d) => d.status === 'completed').length,
        dialoguePending: dialogueLines.filter((d) => d.status === 'pending').length,
        hasMusicTracks: musicTracks.length > 0,
        musicComplete: musicTracks.filter((t) => t.status === 'completed').length,
    };

    const totalDuration = completedShots.reduce(
        (acc, shot) => acc + (shot.duration ?? 5),
        0,
    );

    const canProceed =
        preflightChecks.hasShots && preflightChecks.allShotsComplete;

    const handleStitch = useCallback(async () => {
        setCurrentStep('stitching');
        setError(null);

        try {
            // Step 1: Auto-stitch to create timeline
            const stitchResult = await autoStitchAction({
                episodeId: episode.id,
                mode: 'full',
                gapFillStrategy: 'ignore',
                options: {
                    musicVolume: 0.3,
                    musicFadeInSeconds: 2,
                    musicFadeOutSeconds: 3,
                },
            });

            if (!stitchResult.success) {
                throw new Error(stitchResult.error ?? 'Failed to stitch timeline');
            }

            setCurrentStep('exporting');

            // Step 2: Render video using FFmpeg
            const renderResult = await renderVideoAction({
                episodeId: episode.id,
                quality: 'standard',
                format: 'mp4',
                dialogueVolume,
                musicVolume,
            });

            if (!renderResult.success) {
                throw new Error(renderResult.error ?? 'Failed to render video');
            }

            setFinalVideoUrl(renderResult.finalVideoUrl ?? null);
            setCurrentStep('complete');
            toast.success('Video exported successfully!');
            onComplete();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
            setCurrentStep('error');
        }
    }, [episode.id, onComplete]);

    const handleGoToPublish = () => {
        const episodeSlug = episode.slug ?? episode.id;
        router.push(
            `/home/${accountSlug}/studio/${episode.projectId}/episodes/${episodeSlug}/publish`,
        );
        onOpenChange(false);
    };

    const handleReset = () => {
        setCurrentStep('preflight');
        setError(null);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Download className="h-5 w-5" />
                        Finalize & Export Video
                    </DialogTitle>
                    <DialogDescription>
                        Stitch all shots and audio into a single video ready for publishing.
                    </DialogDescription>
                </DialogHeader>

                {currentStep === 'preflight' && (
                    <div className="space-y-4 py-4">
                        {/* Video Shots Check */}
                        <div className="flex items-start gap-3">
                            <div
                                className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full ${preflightChecks.hasShots && preflightChecks.allShotsComplete
                                    ? 'bg-green-100 text-green-600'
                                    : 'bg-red-100 text-red-600'
                                    }`}
                            >
                                {preflightChecks.hasShots && preflightChecks.allShotsComplete ? (
                                    <Check className="h-3 w-3" />
                                ) : (
                                    <X className="h-3 w-3" />
                                )}
                            </div>
                            <div>
                                <p className="text-sm font-medium text-gray-900 dark:text-white">
                                    Video Shots
                                </p>
                                <p className="text-xs text-gray-500">
                                    {completedShots.length} shots ready • {formatDuration(totalDuration)}
                                </p>
                            </div>
                            <Film className="ml-auto h-4 w-4 text-gray-400" />
                        </div>

                        {/* Dialogue Check */}
                        <div className="flex items-start gap-3">
                            <div
                                className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full ${preflightChecks.dialoguePending === 0
                                    ? 'bg-green-100 text-green-600'
                                    : 'bg-yellow-100 text-yellow-600'
                                    }`}
                            >
                                {preflightChecks.dialoguePending === 0 ? (
                                    <Check className="h-3 w-3" />
                                ) : (
                                    <AlertCircle className="h-3 w-3" />
                                )}
                            </div>
                            <div>
                                <p className="text-sm font-medium text-gray-900 dark:text-white">
                                    Dialogue Audio
                                </p>
                                <p className="text-xs text-gray-500">
                                    {preflightChecks.dialogueComplete} of {dialogueLines.length} lines ready
                                    {preflightChecks.dialoguePending > 0 &&
                                        ` • ${preflightChecks.dialoguePending} pending`}
                                </p>
                            </div>
                            <Mic className="ml-auto h-4 w-4 text-gray-400" />
                        </div>

                        {/* Music Check */}
                        <div className="flex items-start gap-3">
                            <div
                                className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full ${preflightChecks.hasMusicTracks
                                    ? 'bg-green-100 text-green-600'
                                    : 'bg-gray-100 text-gray-400'
                                    }`}
                            >
                                {preflightChecks.hasMusicTracks ? (
                                    <Check className="h-3 w-3" />
                                ) : (
                                    <Music className="h-3 w-3" />
                                )}
                            </div>
                            <div>
                                <p className="text-sm font-medium text-gray-900 dark:text-white">
                                    Background Music
                                </p>
                                <p className="text-xs text-gray-500">
                                    {preflightChecks.musicComplete} tracks ready
                                    {!preflightChecks.hasMusicTracks && ' (optional)'}
                                </p>
                            </div>
                            <Music className="ml-auto h-4 w-4 text-gray-400" />
                        </div>

                        {/* Summary */}
                        <div className="mt-4 rounded-lg bg-gray-50 p-3 dark:bg-gray-800">
                            <p className="text-xs text-gray-600 dark:text-gray-400">
                                The final video will combine {completedShots.length} video shots with{' '}
                                {preflightChecks.dialogueComplete} dialogue lines and{' '}
                                {preflightChecks.musicComplete} music tracks.
                            </p>
                        </div>

                        {/* Volume Settings */}
                        <div className="mt-4 space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                            <div className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
                                <Settings2 className="h-4 w-4" />
                                Audio Mix Settings
                            </div>

                            {/* Dialogue Volume */}
                            <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                    <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                                        <Mic className="h-3 w-3" />
                                        Dialogue Volume
                                    </label>
                                    <span className="text-xs font-medium text-gray-900 dark:text-white">
                                        {Math.round(dialogueVolume * 100)}%
                                    </span>
                                </div>
                                <input
                                    type="range"
                                    min="0"
                                    max="200"
                                    value={dialogueVolume * 100}
                                    onChange={(e) => setDialogueVolume(Number(e.target.value) / 100)}
                                    className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
                                />
                            </div>

                            {/* Music Volume */}
                            <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                    <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                                        <Volume2 className="h-3 w-3" />
                                        Music Volume
                                    </label>
                                    <span className="text-xs font-medium text-gray-900 dark:text-white">
                                        {Math.round(musicVolume * 100)}%
                                    </span>
                                </div>
                                <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={musicVolume * 100}
                                    onChange={(e) => setMusicVolume(Number(e.target.value) / 100)}
                                    className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
                                />
                            </div>
                        </div>
                    </div>
                )}

                {currentStep === 'stitching' && (
                    <div className="flex flex-col items-center py-8">
                        <Loader2 className="h-10 w-10 animate-spin text-blue-500" />
                        <p className="mt-4 text-sm font-medium text-gray-900 dark:text-white">
                            Creating timeline...
                        </p>
                        <p className="text-xs text-gray-500">
                            Aligning shots with audio tracks
                        </p>
                    </div>
                )}

                {currentStep === 'exporting' && (
                    <div className="flex flex-col items-center py-8">
                        <Loader2 className="h-10 w-10 animate-spin text-blue-500" />
                        <p className="mt-4 text-sm font-medium text-gray-900 dark:text-white">
                            Exporting video...
                        </p>
                        <p className="text-xs text-gray-500">
                            Rendering final video with audio
                        </p>
                    </div>
                )}

                {currentStep === 'complete' && (
                    <div className="flex flex-col items-center py-4">
                        <CheckCircle2 className="h-10 w-10 text-green-500" />
                        <p className="mt-3 text-sm font-medium text-gray-900 dark:text-white">
                            Export Complete!
                        </p>

                        {/* Video Player */}
                        {finalVideoUrl && (
                            <div className="mt-4 w-full rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                                <video
                                    controls
                                    autoPlay
                                    className="w-full max-h-[300px] bg-black"
                                    src={finalVideoUrl}
                                >
                                    Your browser does not support the video tag.
                                </video>
                            </div>
                        )}

                        <p className="mt-3 text-xs text-gray-500 text-center">
                            Your video is ready to publish
                        </p>
                    </div>
                )}

                {currentStep === 'error' && (
                    <div className="flex flex-col items-center py-8">
                        <AlertCircle className="h-10 w-10 text-red-500" />
                        <p className="mt-4 text-sm font-medium text-gray-900 dark:text-white">
                            Export Failed
                        </p>
                        <p className="mt-1 text-xs text-red-500">{error}</p>
                    </div>
                )}

                <DialogFooter>
                    {currentStep === 'preflight' && (
                        <>
                            <Button variant="outline" onClick={() => onOpenChange(false)}>
                                Cancel
                            </Button>
                            <Button
                                onClick={handleStitch}
                                disabled={!canProceed}
                                className="gap-2 bg-blue-600 text-white hover:bg-blue-700"
                            >
                                <Download className="h-4 w-4" />
                                Start Export
                            </Button>
                        </>
                    )}

                    {(currentStep === 'stitching' || currentStep === 'exporting') && (
                        <Button variant="outline" disabled>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Processing...
                        </Button>
                    )}

                    {currentStep === 'complete' && (
                        <>
                            <Button variant="outline" onClick={() => onOpenChange(false)}>
                                Close
                            </Button>
                            <Button
                                onClick={handleGoToPublish}
                                className="gap-2 bg-blue-600 text-white hover:bg-blue-700"
                            >
                                Go to Publish
                            </Button>
                        </>
                    )}

                    {currentStep === 'error' && (
                        <>
                            <Button variant="outline" onClick={() => onOpenChange(false)}>
                                Close
                            </Button>
                            <Button onClick={handleReset}>Try Again</Button>
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}
