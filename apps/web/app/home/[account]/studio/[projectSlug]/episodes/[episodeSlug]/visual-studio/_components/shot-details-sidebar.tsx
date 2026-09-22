'use client';

import { useCallback, useMemo, useRef, useState, useTransition } from 'react';

import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Layers,
  MapPin,
  Maximize2,
  MessageCircle,
  Pause,
  Play,
  RefreshCw,
  Trash2,
  Video,
  X,
} from 'lucide-react';

import { VideoUploader } from '@kit/episodes/components';
import { updateShotAction } from '@kit/episodes/server';
import type { Shot } from '@kit/episodes/types';
import { refusalMessage } from '@kit/next/action-result';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@kit/ui/collapsible';
import { toast } from '@kit/ui/sonner';
import { Textarea } from '@kit/ui/textarea';
import { cn } from '@kit/ui/utils';

import { FrameUploader } from './frame-uploader';

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
  characters?: string[];
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
/**
 * Parse time string to seconds
 * Format: SS:FF where SS=seconds, FF=frames (assuming 100fps for simplicity)
 * Examples: "00:00" = 0s, "04:00" = 4s, "08:00" = 8s
 * Note: This is for shot-level timelines, not episode-level
 */
function parseTimeToSeconds(timeStr: string): number {
  const parts = timeStr.split(':');
  if (parts.length !== 2) return 0;
  const seconds = parseInt(parts[0] ?? '0', 10);
  const frames = parseInt(parts[1] ?? '0', 10);
  // Treat as SS:FF format (seconds and centiseconds/frames)
  return seconds + frames / 100;
}

/**
 * Character details for prompt assembly
 */
interface CharacterDetail {
  name: string;
  description: string; // Full description with physical attributes
}

/**
 * Assemble a VEO 3.1 prompt from its component parts at runtime.
 * This ensures the fullPrompt always reflects the current state of all parts.
 * Format matches the LLM-generated structure from scene-shot-generation.json
 */
function assembleVeoPrompt(
  veoPrompt: VeoPromptDataV2,
  options?: {
    projectVideoStyle?: string;
    projectAestheticStyle?: string;
    characterDetails?: CharacterDetail[];
    characterNames?: string[];
  },
): string {
  const lines: string[] = [];

  // 1. Characters section FIRST (for image identification before shot description)
  // Use detailed character info if provided, otherwise extract names from timeline/metadata
  if (options?.characterDetails && options.characterDetails.length > 0) {
    // Detailed format with descriptions
    lines.push('CHARACTERS:');
    for (const char of options.characterDetails) {
      lines.push(`- ${char.name}: ${char.description}`);
    }
    lines.push('(Identify from provided reference images)');
    lines.push('');
  } else {
    // Fallback to simple names-only format
    const characters = options?.characterNames ?? [];
    // Also extract from timeline if not provided
    if (characters.length === 0) {
      const charSet = new Set<string>();
      for (const event of veoPrompt.timeline) {
        if (event.character) {
          charSet.add(event.character);
        }
      }
      characters.push(...charSet);
    }
    if (characters.length > 0) {
      lines.push(
        `CHARACTERS: ${characters.join(', ')} (identify from reference images)`,
      );
      lines.push('');
    }
  }

  // 2. Shot line (camera info)
  lines.push(veoPrompt.shotLine);
  lines.push('');

  // 3. Timeline events formatted as [start-end] content
  for (const event of veoPrompt.timeline) {
    const startSec = parseTimeToSeconds(event.startTime);
    const endSec = parseTimeToSeconds(event.endTime);

    if (event.type === 'dialogue' && event.character) {
      // Dialogue: "[0s-4s] Character: 'text' (Tone: emotion)"
      const emotionPart = event.emotion ? ` (Tone: ${event.emotion})` : '';
      lines.push(
        `[${startSec}s-${endSec}s] ${event.character}: "${event.content}"${emotionPart}`,
      );
    } else {
      // Action/transition: "[0s-4s] content. Setting: location"
      lines.push(`[${startSec}s-${endSec}s] ${event.content}`);
    }
  }
  lines.push('');

  // 4. Audio section
  lines.push(`AUDIO: ${veoPrompt.audio}`);
  lines.push('');

  // 5. Style section (include project aesthetic style if provided)
  let styleText = veoPrompt.style;
  if (options?.projectAestheticStyle) {
    // Append project aesthetic style at the end
    styleText = `${veoPrompt.style}. ${options.projectAestheticStyle}`;
  } else if (options?.projectVideoStyle) {
    // Fallback to video style if no aesthetic style
    styleText = `${veoPrompt.style}. ${options.projectVideoStyle}`;
  }
  lines.push(`STYLE: ${styleText}`);
  lines.push('');

  // 6. Avoid section
  lines.push(`AVOID: ${veoPrompt.avoid}`);

  return lines.join('\n');
}

interface ShotDetailsSidebarProps {
  shot: Shot;
  projectId: string;
  projectVideoStyle?: string;
  projectAestheticStyle?: string;
  characterDetails?: CharacterDetail[];
  onClose: () => void;
  onUpdate: () => void;
}

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
  projectVideoStyle,
  projectAestheticStyle,
  characterDetails,
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
  const shotCharacters = metadata?.characters ?? [];
  const hasVeoData = !!veoPrompt;

  // Hoist character resolution out of JSX IIFE.
  // Read metadata?.characters directly inside the memo to avoid a new
  // array reference on every render (which would retrigger the memo).
  const resolvedCharacters = useMemo(() => {
    const chars = metadata?.characters ?? [];
    if (chars.length === 0 && veoPrompt && isVeoPromptV2(veoPrompt)) {
      const charSet = new Set<string>();
      for (const event of veoPrompt.timeline) {
        if (event.character) charSet.add(event.character);
      }
      return [...charSet];
    }
    return chars;
  }, [metadata?.characters, veoPrompt]);

  const [editedPrompt, setEditedPrompt] = useState(() => {
    if (veoPrompt && isVeoPromptV2(veoPrompt)) {
      return assembleVeoPrompt(veoPrompt, {
        projectVideoStyle,
        projectAestheticStyle,
        characterDetails,
        characterNames: shotCharacters,
      });
    }
    return veoPrompt?.fullPrompt ?? shot.prompt ?? '';
  });

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
        toast.error(refusalMessage(error, 'Failed to regenerate shot'));
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
    (_videoUrl: string, _thumbnailUrl: string) => {
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
        toast.error(refusalMessage(error, 'Failed to remove video'));
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
    <div className="flex h-full w-96 flex-col border-l border-white/20 bg-card/50 shadow-2xl ring-1 ring-border backdrop-blur-2xl backdrop-saturate-150 ring-inset dark:ring-white/10">
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

      {/* Identity Bar — duration + characters + reel score pill */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-white/20 px-4 py-2.5 dark:border-white/10">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {shot.duration}s
        </span>
        <span className="text-gray-300 dark:text-gray-600">•</span>
        <span className="text-sm text-gray-500 dark:text-gray-400">16:9</span>
        {shot.cameraMovement && (
          <>
            <span className="text-gray-300 dark:text-gray-600">•</span>
            <span className="text-sm text-gray-500 capitalize dark:text-gray-400">
              {shot.cameraMovement}
            </span>
          </>
        )}

        {/* Inline character chips */}
        {resolvedCharacters.length > 0 && (
          <>
            <span className="text-gray-300 dark:text-gray-600">•</span>
            {resolvedCharacters.map((char) => (
              <Badge
                key={char}
                variant="secondary"
                className="bg-purple-100 px-1.5 py-0 text-xs text-purple-700 dark:bg-purple-900/50 dark:text-purple-300"
              >
                {char}
              </Badge>
            ))}
          </>
        )}

        {/* At-a-glance reel score pill (right-aligned) */}
        {shot.shortsMetadata?.viralScore != null && (
          <div className="ml-auto flex items-center gap-1.5">
            <Badge
              variant="secondary"
              className={cn(
                'text-xs font-bold',
                shot.shortsMetadata.viralScore >= 7
                  ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300'
                  : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
              )}
            >
              {shot.shortsMetadata.viralScore >= 7 ? '🔥 ' : ''}
              {shot.shortsMetadata.viralScore.toFixed(1)}/10
            </Badge>
            {shot.shortsMetadata.hookType && (
              <Badge
                variant="secondary"
                className="bg-purple-100 text-xs text-purple-700 capitalize dark:bg-purple-900/50 dark:text-purple-300"
              >
                {shot.shortsMetadata.hookType}
              </Badge>
            )}
          </div>
        )}
      </div>

      {/* Scrollable Body — everything below identity bar scrolls */}
      <div className="flex-1 overflow-y-auto">
        {/* Reel Intelligence Accordion */}
        {shot.shortsMetadata &&
          (shot.shortsCandidate || shot.shortsMetadata.whyItDoesntWork) && (
            <Collapsible
              defaultOpen={
                shot.shortsMetadata.viralScore != null &&
                shot.shortsMetadata.viralScore >= 7
              }
            >
              <CollapsibleTrigger asChild>
                <button className="flex w-full items-center justify-between border-b border-white/20 px-4 py-2.5 text-left transition-colors hover:bg-white/5 dark:border-white/10">
                  <span className="text-sm font-medium">
                    {shot.shortsCandidate
                      ? '🔥 Reel Intelligence'
                      : '🚫 Not a Reel candidate'}
                  </span>
                  <ChevronDown className="h-4 w-4 text-gray-400 transition-transform [[data-state=open]>&]:rotate-180" />
                </button>
              </CollapsibleTrigger>

              <CollapsibleContent>
                <div className="space-y-2 border-b border-white/20 px-4 py-3 text-xs dark:border-white/10">
                  {/* Candidate cards */}
                  {shot.shortsCandidate && (
                    <>
                      {shot.shortsMetadata.whyThisWorksAsReel && (
                        <div className="rounded-md bg-green-50 p-2 dark:bg-green-950/30">
                          <p className="mb-0.5 font-semibold text-green-700 dark:text-green-400">
                            ✓ Why this works
                          </p>
                          <p className="line-clamp-3 leading-relaxed text-green-900 dark:text-green-200">
                            {shot.shortsMetadata.whyThisWorksAsReel}
                          </p>
                        </div>
                      )}

                      {shot.shortsMetadata.keyMoment && (
                        <div className="rounded-md bg-amber-50 p-2 dark:bg-amber-950/30">
                          <p className="mb-0.5 font-semibold text-amber-700 dark:text-amber-400">
                            ⚡ Key moment
                          </p>
                          <p className="line-clamp-2 leading-relaxed text-amber-900 dark:text-amber-200">
                            {shot.shortsMetadata.keyMoment}
                          </p>
                        </div>
                      )}

                      {shot.shortsMetadata.sceneEmotionalArc && (
                        <div className="rounded-md bg-blue-50 p-2 dark:bg-blue-950/30">
                          <p className="mb-0.5 font-semibold text-blue-700 dark:text-blue-400">
                            🎭 Emotional arc
                          </p>
                          <p className="line-clamp-2 text-blue-900 dark:text-blue-200">
                            {shot.shortsMetadata.sceneEmotionalArc}
                          </p>
                        </div>
                      )}

                      {shot.shortsMetadata.improvementSuggestion && (
                        <div className="rounded-md bg-gray-50 p-2 dark:bg-gray-800/50">
                          <p className="mb-0.5 font-semibold text-gray-600 dark:text-gray-400">
                            💡 Suggestion
                          </p>
                          <p className="line-clamp-2 leading-relaxed text-gray-700 dark:text-gray-300">
                            {shot.shortsMetadata.improvementSuggestion}
                          </p>
                        </div>
                      )}
                    </>
                  )}

                  {/* Non-candidate reasoning */}
                  {!shot.shortsCandidate && (
                    <>
                      {shot.shortsMetadata.whyItDoesntWork && (
                        <p className="line-clamp-3 leading-relaxed text-gray-500 dark:text-gray-400">
                          {shot.shortsMetadata.whyItDoesntWork}
                        </p>
                      )}
                      {shot.shortsMetadata.improvementSuggestion && (
                        <p className="text-gray-400 italic dark:text-gray-500">
                          Tip: {shot.shortsMetadata.improvementSuggestion}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

        {/* Shot Intelligence Accordion (OpenClaw fields) */}
        {(shot.transitionType ||
          shot.frameStrategy ||
          shot.primarySubject ||
          shot.locationArea) && (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <button className="flex w-full items-center justify-between border-b border-white/20 px-4 py-2.5 text-left transition-colors hover:bg-white/5 dark:border-white/10">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Clapperboard className="h-3.5 w-3.5 text-cyan-500" />
                  Shot Intelligence
                </span>
                <ChevronDown className="h-4 w-4 text-gray-400 transition-transform [[data-state=open]>&]:rotate-180" />
              </button>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <div className="space-y-3 border-b border-white/20 px-4 py-3 dark:border-white/10">
                {/* Transition & Frame Strategy row */}
                <div className="flex flex-wrap items-center gap-2">
                  {shot.transitionType && (
                    <Badge
                      variant="secondary"
                      className={cn(
                        'text-xs capitalize',
                        shot.transitionType === 'continuation'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
                          : shot.transitionType === 'cut'
                            ? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                            : 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300',
                      )}
                    >
                      {shot.transitionType.replace(/_/g, ' ')}
                    </Badge>
                  )}
                  {shot.frameStrategy && (
                    <Badge
                      variant="secondary"
                      className="bg-indigo-100 text-xs text-indigo-700 capitalize dark:bg-indigo-900/50 dark:text-indigo-300"
                    >
                      {shot.frameStrategy.replace(/_/g, ' ')}
                    </Badge>
                  )}
                </div>

                {/* Primary Subject */}
                {shot.primarySubject && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-500 uppercase dark:text-gray-400">
                      Focus
                    </span>
                    <Badge variant="outline" className="text-xs capitalize">
                      {shot.primarySubject.type === 'character'
                        ? '👤'
                        : shot.primarySubject.type === 'location'
                          ? '📍'
                          : '🔍'}{' '}
                      {shot.primarySubject.name}
                    </Badge>
                  </div>
                )}

                {/* Location Area */}
                {shot.locationArea && (
                  <div className="space-y-1">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-gray-500 uppercase dark:text-gray-400">
                      <MapPin className="h-3 w-3" />
                      Location Area
                    </span>
                    <p className="text-xs text-gray-700 dark:text-gray-300">
                      {shot.locationArea}
                    </p>
                  </div>
                )}

                {/* Location Environment Description */}
                {shot.locationEnvironmentDescription && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-500 uppercase dark:text-gray-400">
                        Environment
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          copyToClipboard(
                            shot.locationEnvironmentDescription!,
                            'Environment',
                          )
                        }
                        className="h-5 w-5 p-0"
                      >
                        {copiedField === 'Environment' ? (
                          <Check className="h-3 w-3 text-green-600" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                    <p className="rounded-md bg-white/30 p-2 text-xs leading-relaxed text-gray-700 backdrop-blur-sm dark:bg-white/5 dark:text-gray-300">
                      {shot.locationEnvironmentDescription}
                    </p>
                  </div>
                )}

                {/* First Frame Description */}
                {shot.firstFrameDescription && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-500 uppercase dark:text-gray-400">
                        First Frame
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          copyToClipboard(
                            shot.firstFrameDescription!,
                            'First frame',
                          )
                        }
                        className="h-5 w-5 p-0"
                      >
                        {copiedField === 'First frame' ? (
                          <Check className="h-3 w-3 text-green-600" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                    <p className="rounded-md bg-white/30 p-2 text-xs leading-relaxed text-gray-700 backdrop-blur-sm dark:bg-white/5 dark:text-gray-300">
                      {shot.firstFrameDescription}
                    </p>
                  </div>
                )}

                {/* Last Frame Description */}
                {shot.lastFrameDescription && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-500 uppercase dark:text-gray-400">
                        Last Frame
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          copyToClipboard(
                            shot.lastFrameDescription!,
                            'Last frame',
                          )
                        }
                        className="h-5 w-5 p-0"
                      >
                        {copiedField === 'Last frame' ? (
                          <Check className="h-3 w-3 text-green-600" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                    <p className="rounded-md bg-white/30 p-2 text-xs leading-relaxed text-gray-700 backdrop-blur-sm dark:bg-white/5 dark:text-gray-300">
                      {shot.lastFrameDescription}
                    </p>
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

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

        {/* Storyboard Frames Section */}
        <div className="border-b border-white/20 p-4 dark:border-white/10">
          <h4 className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
            <Layers className="h-3 w-3" />
            Storyboard Frames
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                First Frame
              </span>
              <FrameUploader
                projectId={projectId}
                shotId={shot.id}
                frameType="first"
                currentUrl={shot.firstFrameUrl}
                onUploadComplete={onUpdate}
              />
            </div>
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                Last Frame
              </span>
              <FrameUploader
                projectId={projectId}
                shotId={shot.id}
                frameType="last"
                currentUrl={shot.lastFrameUrl}
                onUploadComplete={onUpdate}
              />
            </div>
          </div>
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
                  <div className="space-y-1.5">
                    {/* Event List - simplified without visual timeline bar */}
                    {veoPrompt.timeline.map((event, idx) => {
                      // Convert time strings to seconds for cleaner display
                      const startSec = parseTimeToSeconds(event.startTime);
                      const endSec = parseTimeToSeconds(event.endTime);
                      return (
                        <div
                          key={idx}
                          className="rounded-lg border border-white/30 bg-white/40 p-2.5 backdrop-blur-sm dark:border-white/10 dark:bg-white/5"
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
                            {/* Show time as seconds: "0s-4s" instead of "00:00-04:00" */}
                            <div className="flex-shrink-0 rounded-md bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                              {startSec}s-{endSec}s
                            </div>
                          </div>
                        </div>
                      );
                    })}
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

            {/* Full VEO Prompt - Copy Ready (assembled at runtime for V2) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
                  Full Prompt
                </h4>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    // Use runtime-assembled prompt for V2, fallback to stored for V1
                    const prompt = isVeoPromptV2(veoPrompt)
                      ? assembleVeoPrompt(veoPrompt, {
                          projectVideoStyle,
                          projectAestheticStyle,
                          characterDetails,
                          characterNames: shotCharacters,
                        })
                      : veoPrompt.fullPrompt;
                    copyToClipboard(prompt, 'Full prompt');
                  }}
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
              <div className="rounded-lg bg-white/30 p-3 text-sm leading-relaxed whitespace-pre-wrap text-gray-700 backdrop-blur-sm dark:bg-white/5 dark:text-gray-300">
                {/* Use runtime-assembled prompt for V2, fallback to stored for V1 */}
                {isVeoPromptV2(veoPrompt)
                  ? assembleVeoPrompt(veoPrompt, {
                      projectVideoStyle,
                      projectAestheticStyle,
                      characterDetails,
                      characterNames: shotCharacters,
                    })
                  : veoPrompt.fullPrompt}
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
              className="resize-none bg-card/50 text-sm"
              placeholder="Describe the visual for this shot..."
            />
          </div>
        )}
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
