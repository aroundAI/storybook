'use client';

import { useState, useTransition } from 'react';

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
  MessageCircle,
  RefreshCw,
  X,
} from 'lucide-react';

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
 * VEO prompt component types (from shot metadata)
 */
interface VeoPromptData {
  subject: string;
  action: string;
  scene: string;
  style: string;
  dialogue?: string;
  sounds: string;
  negativePrompt: string;
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
  veoPrompt?: VeoPromptData;
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

interface ShotDetailsSidebarProps {
  shot: Shot;
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
  onClose,
  onUpdate,
}: ShotDetailsSidebarProps) {
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<'veo' | 'prompt' | 'enhance'>(
    'veo',
  );
  const [componentsExpanded, setComponentsExpanded] = useState(false);
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
  const [negativePrompt, setNegativePrompt] = useState(
    veoPrompt?.negativePrompt ??
      'blurry, low quality, distorted hands, bad anatomy',
  );
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

        {/* VEO 3.1 Tab Content */}
        {activeTab === 'veo' && hasVeoData && (
          <div className="space-y-4 p-4">
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

            {/* Full VEO Prompt - Copy Ready */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
                  VEO 3.1 Prompt
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
              <div className="rounded-lg bg-white/30 p-3 text-sm leading-relaxed text-gray-700 backdrop-blur-sm dark:bg-white/5 dark:text-gray-300">
                {veoPrompt.fullPrompt}
              </div>
            </div>

            {/* Reference Images */}
            {referenceImages &&
              (referenceImages.characters.length > 0 ||
                referenceImages.locations.length > 0) && (
                <div className="space-y-2">
                  <h4 className="flex items-center gap-2 text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
                    <ImageIcon className="h-3 w-3" />
                    Reference Images (Ingredients)
                  </h4>
                  <div className="grid grid-cols-2 gap-2">
                    {referenceImages.characters.map((img) => (
                      <a
                        key={img.name}
                        href={img.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex items-center gap-2 rounded-lg border border-white/30 bg-white/40 p-2 backdrop-blur-sm transition-colors hover:border-purple-300/50 hover:bg-purple-50/50 dark:border-white/10 dark:bg-white/5 dark:hover:border-purple-500/30 dark:hover:bg-purple-900/20"
                      >
                        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-purple-100 dark:bg-purple-900/50">
                          <span className="text-xs font-medium text-purple-600 dark:text-purple-400">
                            C
                          </span>
                        </div>
                        <div className="flex-1 truncate">
                          <p className="truncate text-xs font-medium text-gray-700 dark:text-gray-300">
                            {img.name}
                          </p>
                          <p className="text-xs text-gray-500">Character</p>
                        </div>
                        <Download className="h-3 w-3 text-gray-400 opacity-0 transition-opacity group-hover:opacity-100" />
                      </a>
                    ))}
                    {referenceImages.locations.map((img) => (
                      <a
                        key={img.name}
                        href={img.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex items-center gap-2 rounded-lg border border-white/30 bg-white/40 p-2 backdrop-blur-sm transition-colors hover:border-blue-300/50 hover:bg-blue-50/50 dark:border-white/10 dark:bg-white/5 dark:hover:border-blue-500/30 dark:hover:bg-blue-900/20"
                      >
                        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-100 dark:bg-blue-900/50">
                          <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                            L
                          </span>
                        </div>
                        <div className="flex-1 truncate">
                          <p className="truncate text-xs font-medium text-gray-700 dark:text-gray-300">
                            {img.name}
                          </p>
                          <p className="text-xs text-gray-500">Location</p>
                        </div>
                        <Download className="h-3 w-3 text-gray-400 opacity-0 transition-opacity group-hover:opacity-100" />
                      </a>
                    ))}
                  </div>
                </div>
              )}

            {/* Dialogue Timing */}
            {dialogueTiming && dialogueTiming.length > 0 && (
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

            {/* Expandable VEO Components */}
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
                    value: veoPrompt.subject,
                  },
                  { key: 'action', label: 'Action', value: veoPrompt.action },
                  { key: 'scene', label: 'Scene', value: veoPrompt.scene },
                  { key: 'style', label: 'Style', value: veoPrompt.style },
                  {
                    key: 'dialogue',
                    label: 'Dialogue',
                    value: veoPrompt.dialogue,
                  },
                  { key: 'sounds', label: 'Sounds', value: veoPrompt.sounds },
                  {
                    key: 'negative',
                    label: 'Negative',
                    value: veoPrompt.negativePrompt,
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
                              copyToClipboard(component.value!, component.label)
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
