'use client';

import { useCallback, useRef, useState, useTransition } from 'react';

import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Maximize2,
  MessageCircle,
  Pause,
  Play,
  RefreshCw,
  Trash2,
  Upload,
  Video,
  X,
} from 'lucide-react';

import { VideoUploader } from '@kit/episodes/components';
import { updateShotAction } from '@kit/episodes/server';
import type { Shot } from '@kit/episodes/types';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@kit/ui/collapsible';
import { Input } from '@kit/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { toast } from '@kit/ui/sonner';
import { Textarea } from '@kit/ui/textarea';
import { cn } from '@kit/ui/utils';

/**
 * VEO prompt component types (from shot metadata) - Legacy v1 format
 */
interface VeoPromptDataV1 {
  subject: string;
  action: string;
  scene: string;
  style: string;
  dialogue?: string;
  sounds: string;
  negativePrompt: string;
  fullPrompt: string;
}

/**
 * VEO prompt component types - New v2 timeline format
 */
interface TimelineEvent {
  startTime: string;
  endTime: string;
  type: 'action' | 'dialogue' | 'transition';
  character?: string;
  content: string;
  emotion?: string | null;
}

interface VeoPromptDataV2 {
  shotLine: string;
  timeline: TimelineEvent[];
  audio: string;
  style: string;
  avoid: string;
  fullPrompt: string;
}

interface ReferenceImage {
  name: string;
  url: string;
}

interface DialogueTiming {
  startSeconds: number;
  durationSeconds: number;
  characterName: string;
  text: string;
  emotion: string | null;
}

interface ShotMetadataExtended {
  location?: string;
  timeOfDay?: string;
  mood?: string;
  lighting?: string;
  shotType?: string;
  action?: string;
  veoPrompt?: VeoPromptDataV1 | VeoPromptDataV2;
  referenceImages?: {
    characters: ReferenceImage[];
    locations: ReferenceImage[];
  };
  dialogueTiming?: DialogueTiming[];
  missingAssets?: {
    characters: string[];
    locations: string[];
  };
}

/**
 * Type guard for v2 VEO prompt format
 */
function isVeoPromptV2(
  prompt: VeoPromptDataV1 | VeoPromptDataV2,
): prompt is VeoPromptDataV2 {
  return 'timeline' in prompt && 'shotLine' in prompt;
}

/**
 * Parse timestamp string "MM:SS" to seconds
 */
function parseTimeToSeconds(timeStr: string): number {
  const parts = timeStr.split(':');
  if (parts.length !== 2) return 0;
  const minutes = parseInt(parts[0] ?? '0', 10);
  const seconds = parseInt(parts[1] ?? '0', 10);
  return minutes * 60 + seconds;
}

interface ShotDetailsSidebarProps {
  shot: Shot;
  projectId: string;
  onClose: () => void;
  onUpdate: () => void;
}

const MOVEMENTS = [
  { value: 'static', label: 'Static' },
  { value: 'pan', label: 'Pan' },
  { value: 'tilt', label: 'Tilt' },
  { value: 'dolly', label: 'Dolly' },
  { value: 'tracking', label: 'Tracking' },
  { value: 'crane', label: 'Crane' },
  { value: 'handheld', label: 'Handheld' },
] as const;

const ANGLES = [
  { value: 'wide', label: 'Wide' },
  { value: 'medium', label: 'Medium' },
  { value: 'close-up', label: 'Close-up' },
  { value: 'extreme-close-up', label: 'Extreme Close-up' },
  { value: 'over-shoulder', label: 'Over Shoulder' },
  { value: 'pov', label: 'POV' },
] as const;

const LIGHTING = [
  { value: 'soft-day', label: 'Soft Day' },
  { value: 'golden-hour', label: 'Golden Hour' },
  { value: 'night', label: 'Night' },
  { value: 'studio', label: 'Studio' },
  { value: 'dramatic', label: 'Dramatic' },
  { value: 'natural', label: 'Natural' },
] as const;

const STYLES = [
  { value: 'watercolor', label: 'Watercolor' },
  { value: 'cinematic', label: 'Cinematic' },
  { value: 'anime', label: 'Anime' },
  { value: 'realistic', label: 'Realistic' },
  { value: 'cartoon', label: 'Cartoon' },
  { value: 'painterly', label: 'Painterly' },
] as const;

/**
 * Copy text to clipboard with toast feedback
 */
function useCopyToClipboard() {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyToClipboard = async (text: string, fieldName: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldName);
      toast.success(`${fieldName} copied to clipboard`);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  };

  return { copiedField, copyToClipboard };
}

export function ShotDetailsSidebar({
  shot,
  projectId,
  onClose,
  onUpdate,
}: ShotDetailsSidebarProps) {
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<'veo' | 'prompt' | 'enhance'>(
    'veo',
  );
  const [componentsExpanded, setComponentsExpanded] = useState(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { copiedField, copyToClipboard } = useCopyToClipboard();

  // Extract VEO metadata from shot
  const metadata = shot.metadata as ShotMetadataExtended | undefined;
  const veoPrompt = metadata?.veoPrompt;
  const referenceImages = metadata?.referenceImages;
  const dialogueTiming = metadata?.dialogueTiming;
  const missingAssets = metadata?.missingAssets;
  const hasVeoData = !!veoPrompt;

  // Form state
  const [editedPrompt, setEditedPrompt] = useState(
    veoPrompt?.fullPrompt ?? shot.prompt ?? '',
  );
  const [movement, setMovement] = useState(shot.cameraMovement ?? 'static');
  const [angle, setAngle] = useState(shot.cameraAngle ?? 'medium');
  const [lighting, setLighting] = useState('soft-day');
  const [style, setStyle] = useState('watercolor');
  const [negativePrompt, setNegativePrompt] = useState(() => {
    if (!veoPrompt) return 'blurry, low quality, distorted hands, bad anatomy';
    if (isVeoPromptV2(veoPrompt)) return veoPrompt.avoid;
    return (
      veoPrompt.negativePrompt ??
      'blurry, low quality, distorted hands, bad anatomy'
    );
  });
  const [seed, setSeed] = useState(
    Math.floor(Math.random() * 1000000000).toString(),
  );

  const handleCopySeed = () => {
    copyToClipboard(seed, 'Seed');
  };

  const handleRegenerate = () => {
    startTransition(async () => {
      try {
        const result = await updateShotAction({
          shotId: shot.id,
          prompt: editedPrompt,
        });

        if (result.success) {
          toast.info('Shot queued for regeneration');
          onUpdate();
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Failed to regenerate shot',
        );
      }
    });
  };

  const handleEnhanceWithAI = () => {
    toast.info('AI enhancement coming soon');
    // TODO: Integrate with AI prompt enhancement
  };

  const handleVideoPlayPause = useCallback(() => {
    if (videoRef.current) {
      if (isVideoPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsVideoPlaying(!isVideoPlaying);
    }
  }, [isVideoPlaying]);

  const handleVideoUploadComplete = useCallback(
    (videoUrl: string, thumbnailUrl: string) => {
      toast.success('Video uploaded successfully');
      onUpdate();
    },
    [onUpdate],
  );

  const handleRemoveVideo = useCallback(() => {
    startTransition(async () => {
      try {
        const result = await updateShotAction({
          shotId: shot.id,
          videoUrl: '',
          thumbnailUrl: '',
          status: 'pending',
        });

        if (result.success) {
          toast.success('Video removed');
          onUpdate();
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Failed to remove video',
        );
      }
    });
  }, [shot.id, onUpdate]);

  const handleFullscreen = useCallback(() => {
    if (videoRef.current) {
      if (videoRef.current.requestFullscreen) {
        videoRef.current.requestFullscreen();
      }
    }
  }, []);

  return (
    <div className="flex h-full w-96 flex-col border-l border-white/20 bg-white/50 shadow-2xl ring-1 ring-white/30 backdrop-blur-2xl backdrop-saturate-150 ring-inset dark:border-white/10 dark:bg-gray-900/50 dark:ring-white/10">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/20 p-4 dark:border-white/10">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Shot {shot.sceneNumber}.{shot.shotNumber} Details
        </h3>
        <div className="flex items-center gap-1">
          <button className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300">
            <ExternalLink className="h-5 w-5" />
          </button>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Info Bar */}
      <div className="flex items-center gap-3 border-b border-white/20 px-4 py-3 dark:border-white/10">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {shot.duration}s Duration
        </span>
        <span className="text-gray-300 dark:text-gray-600">•</span>
        <span className="text-sm text-gray-500 dark:text-gray-400">16:9</span>
        <span className="text-gray-300 dark:text-gray-600">•</span>
        <span className="text-sm text-gray-500 capitalize dark:text-gray-400">
          {movement}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Tab Headers */}
        <div className="flex items-center gap-2 border-b border-white/20 px-4 py-2 dark:border-white/10">
          {hasVeoData && (
            <button
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-semibold tracking-wide uppercase transition-colors',
                activeTab === 'veo'
                  ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300'
                  : 'text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300',
              )}
              onClick={() => setActiveTab('veo')}
            >
              VEO 3.1
            </button>
          )}
          <button
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-semibold tracking-wide uppercase transition-colors',
              activeTab === 'prompt'
                ? 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                : 'text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300',
            )}
            onClick={() => setActiveTab('prompt')}
          >
            Edit Prompt
          </button>
          <button
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              activeTab === 'enhance'
                ? 'bg-blue-600 text-white'
                : 'bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50',
            )}
            onClick={() => {
              setActiveTab('enhance');
              handleEnhanceWithAI();
            }}
          >
            AI
          </button>
        </div>

        {/* Video Section */}
        <div className="border-b border-white/20 p-4 dark:border-white/10">
          <h4 className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
            <Video className="h-3 w-3" />
            Video
          </h4>

          {shot.videoUrl ? (
            <div className="space-y-3">
              {/* Video Player */}
              <div className="group relative overflow-hidden rounded-lg bg-black">
                <video
                  ref={videoRef}
                  src={shot.videoUrl}
                  poster={shot.thumbnailUrl ?? undefined}
                  className="aspect-video w-full object-contain"
                  onPlay={() => setIsVideoPlaying(true)}
                  onPause={() => setIsVideoPlaying(false)}
                  onEnded={() => setIsVideoPlaying(false)}
                />
                {/* Play/Pause Overlay */}
                <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={handleVideoPlayPause}
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-gray-900 shadow-lg transition-transform hover:scale-110"
                  >
                    {isVideoPlaying ? (
                      <Pause className="h-5 w-5" />
                    ) : (
                      <Play className="ml-0.5 h-5 w-5" />
                    )}
                  </button>
                </div>
                {/* Fullscreen Button */}
                <button
                  onClick={handleFullscreen}
                  className="absolute top-2 right-2 rounded bg-black/50 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/70"
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
              </div>

              {/* Video Actions */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'video/mp4,video/webm,video/quicktime';
                    input.onchange = async (e) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (file) {
                        // Trigger upload through uploader component
                        toast.info(
                          'Use the uploader after removing current video',
                        );
                      }
                    };
                    input.click();
                  }}
                  className="flex-1 gap-1.5 bg-white/40 text-xs backdrop-blur-sm dark:bg-white/5"
                >
                  <RefreshCw className="h-3 w-3" />
                  Replace
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRemoveVideo}
                  disabled={isPending}
                  className="gap-1.5 bg-white/40 text-xs text-red-600 backdrop-blur-sm hover:bg-red-50 hover:text-red-700 dark:bg-white/5 dark:text-red-400 dark:hover:bg-red-900/20"
                >
                  <Trash2 className="h-3 w-3" />
                  Remove
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                  className="gap-1.5 bg-white/40 text-xs backdrop-blur-sm dark:bg-white/5"
                >
                  <a href={shot.videoUrl} download>
                    <Download className="h-3 w-3" />
                  </a>
                </Button>
              </div>
            </div>
          ) : (
            <VideoUploader
              projectId={projectId}
              shotId={shot.id}
              onUploadComplete={handleVideoUploadComplete}
              onError={(error) => toast.error(error.message)}
              compact
            />
          )}
        </div>

        {/* VEO 3.1 Tab Content */}
        {activeTab === 'veo' && hasVeoData && (
          <div className="space-y-4 p-4">
            {/* Character Reference Images - Prominent at top */}
            {referenceImages && referenceImages.characters.length > 0 && (
              <div className="space-y-2">
                <h4 className="flex items-center gap-2 text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
                  <ImageIcon className="h-3 w-3" />
                  Characters in Shot
                </h4>
                <div className="flex flex-wrap gap-3">
                  {referenceImages.characters.map((img) => (
                    <a
                      key={img.name}
                      href={img.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group relative flex flex-col items-center gap-1.5"
                    >
                      <div className="relative h-14 w-14 overflow-hidden rounded-full border-2 border-purple-300/50 shadow-lg ring-2 ring-white/50 transition-all hover:border-purple-400 hover:ring-purple-200/50 dark:border-purple-500/50 dark:ring-white/10">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={img.url}
                          alt={img.name}
                          className="h-full w-full object-cover transition-transform group-hover:scale-110"
                        />
                      </div>
                      <span className="max-w-[70px] truncate text-xs font-medium text-gray-700 dark:text-gray-300">
                        {img.name}
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Missing Assets Warning */}
            {missingAssets &&
              (missingAssets.characters.length > 0 ||
                missingAssets.locations.length > 0) && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="text-sm">
                    <p className="font-medium text-amber-800 dark:text-amber-300">
                      Missing Reference Images
                    </p>
                    <p className="mt-1 text-amber-700 dark:text-amber-400">
                      {missingAssets.characters.length > 0 && (
                        <span>
                          Characters: {missingAssets.characters.join(', ')}
                        </span>
                      )}
                      {missingAssets.characters.length > 0 &&
                        missingAssets.locations.length > 0 && <span> • </span>}
                      {missingAssets.locations.length > 0 && (
                        <span>
                          Locations: {missingAssets.locations.join(', ')}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              )}

            {/* VEO 3.1 V2 Format - Timeline View */}
            {isVeoPromptV2(veoPrompt) && (
              <>
                {/* Shot Line */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
                      Camera
                    </h4>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        copyToClipboard(veoPrompt.shotLine, 'Shot line')
                      }
                      className="h-6 gap-1 text-xs"
                    >
                      {copiedField === 'Shot line' ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </Button>
                  </div>
                  <div className="rounded-lg border border-purple-200/50 bg-purple-50/50 p-2.5 text-sm font-medium text-purple-800 dark:border-purple-800/50 dark:bg-purple-900/20 dark:text-purple-300">
                    {veoPrompt.shotLine}
                  </div>
                </div>

                {/* Timeline Events */}
                <div className="space-y-2">
                  <h4 className="flex items-center gap-2 text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
                    <Clock className="h-3 w-3" />
                    Timeline ({shot.duration}s)
                  </h4>
                  <div className="relative space-y-1.5">
                    {/* Timeline Bar */}
                    <div className="mb-3 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                      {veoPrompt.timeline.map((event, idx) => {
                        const startSec = parseTimeToSeconds(event.startTime);
                        const endSec = parseTimeToSeconds(event.endTime);
                        const duration = shot.duration || 8;
                        const left = (startSec / duration) * 100;
                        const width = ((endSec - startSec) / duration) * 100;
                        const colors = {
                          action: 'bg-blue-500',
                          dialogue: 'bg-purple-500',
                          transition: 'bg-gray-400',
                        };
                        return (
                          <div
                            key={idx}
                            className={cn(
                              'absolute top-0 h-full rounded-full',
                              colors[event.type],
                            )}
                            style={{ left: `${left}%`, width: `${width}%` }}
                            title={`${event.type}: ${event.startTime}-${event.endTime}`}
                          />
                        );
                      })}
                    </div>

                    {/* Event List */}
                    {veoPrompt.timeline.map((event, idx) => (
                      <div
                        key={idx}
                        className={cn(
                          'rounded-lg border p-2.5 backdrop-blur-sm',
                          event.type === 'dialogue'
                            ? 'border-purple-200/50 bg-purple-50/50 dark:border-purple-800/50 dark:bg-purple-900/20'
                            : event.type === 'action'
                              ? 'border-blue-200/50 bg-blue-50/50 dark:border-blue-800/50 dark:bg-blue-900/20'
                              : 'border-gray-200/50 bg-gray-50/50 dark:border-gray-700/50 dark:bg-gray-800/30',
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <div className="mb-1 flex items-center gap-2">
                              <Badge
                                variant="secondary"
                                className={cn(
                                  'text-xs capitalize',
                                  event.type === 'dialogue' &&
                                    'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300',
                                  event.type === 'action' &&
                                    'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
                                )}
                              >
                                {event.type}
                              </Badge>
                              {event.character && (
                                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                                  {event.character}
                                </span>
                              )}
                              {event.emotion && (
                                <Badge
                                  variant="outline"
                                  className="text-xs capitalize"
                                >
                                  {event.emotion}
                                </Badge>
                              )}
                            </div>
                            <p
                              className={cn(
                                'text-sm',
                                event.type === 'dialogue'
                                  ? 'font-medium text-gray-800 dark:text-gray-200'
                                  : 'text-gray-600 dark:text-gray-400',
                              )}
                            >
                              {event.type === 'dialogue'
                                ? `"${event.content}"`
                                : event.content}
                            </p>
                          </div>
                          <div className="flex-shrink-0 rounded-md bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                            {event.startTime}-{event.endTime}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Audio & Style */}
                <div className="grid grid-cols-1 gap-2">
                  {[
                    { key: 'audio', label: 'Audio', value: veoPrompt.audio },
                    { key: 'style', label: 'Style', value: veoPrompt.style },
                    { key: 'avoid', label: 'Avoid', value: veoPrompt.avoid },
                  ].map((item) => (
                    <div
                      key={item.key}
                      className="rounded-lg border border-white/30 bg-white/30 p-2 backdrop-blur-sm dark:border-white/10 dark:bg-white/5"
                    >
                      <div className="mb-0.5 flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-500 uppercase dark:text-gray-400">
                          {item.label}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            copyToClipboard(item.value, item.label)
                          }
                          className="h-5 w-5 p-0"
                        >
                          {copiedField === item.label ? (
                            <Check className="h-3 w-3 text-green-600" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                      <p className="text-xs text-gray-700 dark:text-gray-300">
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Full VEO Prompt - Copy Ready */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
                  Full Prompt
                </h4>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    copyToClipboard(veoPrompt.fullPrompt, 'Full prompt')
                  }
                  className="h-7 gap-1.5 text-xs"
                >
                  {copiedField === 'Full prompt' ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  {copiedField === 'Full prompt' ? 'Copied!' : 'Copy'}
                </Button>
              </div>
              <div className="max-h-40 overflow-y-auto rounded-lg bg-white/30 p-3 text-sm leading-relaxed whitespace-pre-wrap text-gray-700 backdrop-blur-sm dark:bg-white/5 dark:text-gray-300">
                {veoPrompt.fullPrompt}
              </div>
            </div>

            {/* Location Reference Images */}
            {referenceImages && referenceImages.locations.length > 0 && (
              <div className="space-y-2">
                <h4 className="flex items-center gap-2 text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
                  <ImageIcon className="h-3 w-3" />
                  Location
                </h4>
                <div className="flex flex-wrap gap-2">
                  {referenceImages.locations.map((img) => (
                    <a
                      key={img.name}
                      href={img.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group relative overflow-hidden rounded-lg border border-blue-200/50 shadow-md transition-all hover:border-blue-400 dark:border-blue-700/50"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.url}
                        alt={img.name}
                        className="h-16 w-28 object-cover transition-transform group-hover:scale-105"
                      />
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1">
                        <span className="text-xs font-medium text-white">
                          {img.name}
                        </span>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Legacy V1 Format - Dialogue Timing */}
            {!isVeoPromptV2(veoPrompt) &&
              dialogueTiming &&
              dialogueTiming.length > 0 && (
                <div className="space-y-2">
                  <h4 className="flex items-center gap-2 text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
                    <MessageCircle className="h-3 w-3" />
                    Dialogue in Shot
                  </h4>
                  <div className="space-y-2">
                    {dialogueTiming.map((d, idx) => (
                      <div
                        key={idx}
                        className="rounded-lg border border-white/30 bg-white/40 p-3 backdrop-blur-sm dark:border-white/10 dark:bg-white/5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-gray-900 dark:text-white">
                                {d.characterName}
                              </span>
                              {d.emotion && (
                                <Badge
                                  variant="secondary"
                                  className="text-xs capitalize"
                                >
                                  {d.emotion}
                                </Badge>
                              )}
                            </div>
                            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                              &ldquo;{d.text}&rdquo;
                            </p>
                          </div>
                          <div className="flex items-center gap-1 text-xs text-gray-500">
                            <Clock className="h-3 w-3" />
                            {d.startSeconds.toFixed(1)}s
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            {/* Legacy V1 Format - Expandable VEO Components */}
            {!isVeoPromptV2(veoPrompt) && (
              <Collapsible
                open={componentsExpanded}
                onOpenChange={setComponentsExpanded}
              >
                <CollapsibleTrigger asChild>
                  <button className="flex w-full items-center justify-between rounded-lg border border-white/30 bg-white/40 px-3 py-2 text-left backdrop-blur-sm transition-colors hover:bg-white/50 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10">
                    <span className="text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
                      VEO Prompt Components (7)
                    </span>
                    {componentsExpanded ? (
                      <ChevronUp className="h-4 w-4 text-gray-400" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-gray-400" />
                    )}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 space-y-2">
                  {[
                    {
                      key: 'subject',
                      label: 'Subject',
                      value: (veoPrompt as VeoPromptDataV1).subject,
                    },
                    {
                      key: 'action',
                      label: 'Action',
                      value: (veoPrompt as VeoPromptDataV1).action,
                    },
                    {
                      key: 'scene',
                      label: 'Scene',
                      value: (veoPrompt as VeoPromptDataV1).scene,
                    },
                    {
                      key: 'style',
                      label: 'Style',
                      value: (veoPrompt as VeoPromptDataV1).style,
                    },
                    {
                      key: 'dialogue',
                      label: 'Dialogue',
                      value: (veoPrompt as VeoPromptDataV1).dialogue,
                    },
                    {
                      key: 'sounds',
                      label: 'Sounds',
                      value: (veoPrompt as VeoPromptDataV1).sounds,
                    },
                    {
                      key: 'negative',
                      label: 'Negative',
                      value: (veoPrompt as VeoPromptDataV1).negativePrompt,
                    },
                  ].map(
                    (component) =>
                      component.value && (
                        <div
                          key={component.key}
                          className="rounded-lg border border-white/30 bg-white/30 p-2 backdrop-blur-sm dark:border-white/10 dark:bg-white/5"
                        >
                          <div className="mb-1 flex items-center justify-between">
                            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                              {component.label}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                copyToClipboard(
                                  component.value!,
                                  component.label,
                                )
                              }
                              className="h-5 w-5 p-0"
                            >
                              {copiedField === component.label ? (
                                <Check className="h-3 w-3 text-green-600" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                            </Button>
                          </div>
                          <p className="text-xs text-gray-700 dark:text-gray-300">
                            {component.value}
                          </p>
                        </div>
                      ),
                  )}
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        )}

        {/* Edit Prompt Tab */}
        {activeTab === 'prompt' && (
          <div className="border-b border-white/20 p-4 dark:border-white/10">
            <Textarea
              value={editedPrompt}
              onChange={(e) => setEditedPrompt(e.target.value)}
              rows={8}
              className="resize-none bg-white/50 text-sm dark:bg-gray-800/50"
              placeholder="Describe the visual for this shot..."
            />
          </div>
        )}

        {/* Settings Grid */}
        <div className="grid grid-cols-2 gap-4 border-b border-white/20 p-4 dark:border-white/10">
          {/* Movement */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
              Movement
            </label>
            <Select
              value={movement}
              onValueChange={(v) => setMovement(v as typeof movement)}
            >
              <SelectTrigger className="bg-white/40 backdrop-blur-sm dark:bg-white/5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MOVEMENTS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Angle */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
              Angle
            </label>
            <Select
              value={angle}
              onValueChange={(v) => setAngle(v as typeof angle)}
            >
              <SelectTrigger className="bg-white/40 backdrop-blur-sm dark:bg-white/5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ANGLES.map((a) => (
                  <SelectItem key={a.value} value={a.value}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Lighting */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
              Lighting
            </label>
            <Select value={lighting} onValueChange={setLighting}>
              <SelectTrigger className="bg-white/40 backdrop-blur-sm dark:bg-white/5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LIGHTING.map((l) => (
                  <SelectItem key={l.value} value={l.value}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Style */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
              Style
            </label>
            <Select value={style} onValueChange={setStyle}>
              <SelectTrigger className="bg-white/40 backdrop-blur-sm dark:bg-white/5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STYLES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Negative Prompt */}
        <div className="border-b border-white/20 p-4 dark:border-white/10">
          <label className="mb-1.5 block text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
            Negative Prompt
          </label>
          <Input
            value={negativePrompt}
            onChange={(e) => setNegativePrompt(e.target.value)}
            placeholder="blurry, low quality, distorted hands..."
            className="bg-white/50 text-sm dark:bg-gray-800/50"
          />
        </div>

        {/* Seed */}
        <div className="p-4">
          <label className="mb-1.5 block text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
            Seed
          </label>
          <div className="flex gap-2">
            <Input
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder="Random"
              className="flex-1 bg-white/50 font-mono text-sm dark:bg-gray-800/50"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={handleCopySeed}
              className="shrink-0 bg-white/40 backdrop-blur-sm dark:bg-white/5"
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-white/20 p-4 dark:border-white/10">
        <Button
          variant="outline"
          onClick={handleRegenerate}
          disabled={isPending}
          className="w-full gap-2 bg-white/40 backdrop-blur-sm dark:bg-white/5"
        >
          <RefreshCw className={cn('h-4 w-4', isPending && 'animate-spin')} />
          {isPending ? 'Regenerating...' : 'Regenerate Shot'}
        </Button>
      </div>
    </div>
  );
}
