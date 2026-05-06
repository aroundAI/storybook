'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';

import {
  ChevronDown,
  ChevronUp,
  Download,
  Filter,
  Flame,
  Info,
  Loader2,
  Play,
  PlusCircle,
  Search,
  Sparkles,
  X,
} from 'lucide-react';


import { useAssets } from '@kit/assets/hooks';
import type { EpisodeViralQuality, EpisodeWithShots, Shot, ShotStatus } from '@kit/episodes/types';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';

import { useLlmJob } from '@kit/ui/hooks';
import { Input } from '@kit/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { toast } from '@kit/ui/sonner';
import { cn } from '@kit/ui/utils';

import { ShotCard } from './shot-card';
import { ShotDetailsSidebar } from './shot-details-sidebar';

interface VisualStudioScreenProps {
  episode: EpisodeWithShots;
  refetchEpisode: () => void;
}

interface ShotFilter {
  sceneNumber?: number;
  status?: ShotStatus;
  searchQuery?: string;
}

// Helper to determine shot size for comic strip layout
function getShotSize(index: number): 'lg' | 'md' | 'sm' {
  // First shot of each scene is large (spans 2 columns)
  if (index === 0) return 'lg';

  // Every 4th shot is medium
  if (index % 4 === 1) return 'md';

  // Alternate between md and sm for variety
  return index % 2 === 0 ? 'md' : 'sm';
}

// Helper to extract unique character names from shot metadata.
// Aggregates from both metadata.characters and the VEO timeline using a
// case-insensitive Map to prevent duplicates (e.g. "Alice" and "alice").
function extractCharacters(shot: Shot): string[] {
  const metadata = shot.metadata as {
    veoPrompt?: {
      timeline?: Array<{ character?: string | null }>;
    };
    characters?: string[];
  } | null;

  const charMap = new Map<string, string>();
  const addChar = (name: string) => {
    const lower = name.toLowerCase();
    if (!charMap.has(lower)) charMap.set(lower, name);
  };

  if (metadata?.characters) {
    metadata.characters.forEach(addChar);
  }

  if (metadata?.veoPrompt?.timeline) {
    for (const event of metadata.veoPrompt.timeline) {
      if (event.character) addChar(event.character);
    }
  }

  return Array.from(charMap.values());
}

export function VisualStudioScreen({
  episode,
  refetchEpisode,
}: VisualStudioScreenProps) {
  const [_isPending, _startTransition] = useTransition();
  const [filter, setFilter] = useState<ShotFilter>({});
  const [selectedShot, setSelectedShot] = useState<Shot | null>(null);
  const [showShortsOnly, setShowShortsOnly] = useState(false);
  const [viralScorecardExpanded, setViralScorecardExpanded] = useState(false);
  const viralQuality = episode.viralQuality as EpisodeViralQuality | undefined | null;


  // WebSocket for shot-generation results (when shot list is generated while on this tab)
  const {
    status: shotGenStatus,
    result: shotGenResult,
    error: shotGenError,
  } = useLlmJob<{ success: boolean }>('shot-generation');

  // Handle shot-generation result (refresh to show generated shots)
  useEffect(() => {
    if (shotGenStatus === 'success' && shotGenResult) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultData = shotGenResult as any;
      if (resultData?.success) {
        toast.success('Shot list generated successfully');
        refetchEpisode();
      }
    } else if (shotGenStatus === 'error') {
      toast.error(shotGenError || 'Failed to generate shot list');
    }
  }, [shotGenStatus, shotGenResult, shotGenError, refetchEpisode]);

  // Sync selectedShot with updated episode data after refetch
  // We intentionally only depend on episode.shots because we want to update
  // the selectedShot when the episode data changes, not when selectedShot changes
  useEffect(() => {
    setSelectedShot((currentShot) => {
      if (currentShot) {
        const updatedShot = episode.shots.find((s) => s.id === currentShot.id);
        if (updatedShot) {
          return updatedShot;
        }
      }
      return currentShot;
    });
  }, [episode.shots]);

  // Fetch project characters to get descriptions for shot prompts
  const { assets: projectCharacters, fetchAssets: fetchCharacters } = useAssets(
    {
      projectId: episode.projectId,
      type: 'character',
      limit: 100,
    },
  );

  // Fetch project locations for export
  const { assets: projectLocations, fetchAssets: fetchLocations } = useAssets({
    projectId: episode.projectId,
    type: 'location',
    limit: 100,
  });

  // Fetch assets on mount
  useEffect(() => {
    fetchCharacters();
    fetchLocations();
  }, [fetchCharacters, fetchLocations]);

  const shots = episode.shots;

  // Get unique scene numbers for filter
  const sceneNumbers = useMemo(() => {
    const numbers = [...new Set(shots.map((s) => s.sceneNumber))];
    return numbers.sort((a, b) => a - b);
  }, [shots]);

  // Scene-level shorts candidates (all shots in a scene share the same decision)
  const shortsCandidateScenes = useMemo(() => {
    const sceneMap = new Map<number, Shot[]>();
    for (const shot of shots) {
      if (!shot.shortsCandidate) continue;
      if (!sceneMap.has(shot.sceneNumber)) sceneMap.set(shot.sceneNumber, []);
      sceneMap.get(shot.sceneNumber)!.push(shot);
    }
    return [...sceneMap.entries()]
      .map(([sceneNumber, sceneShots]) => ({
        sceneNumber,
        shots: sceneShots,
        viralScore: sceneShots[0]?.shortsMetadata?.viralScore ?? 0,
        estimatedDurationSeconds:
          sceneShots[0]?.shortsMetadata?.estimatedDurationSeconds ??
          sceneShots.reduce((s, sh) => s + (sh.durationSeconds ?? sh.duration ?? 8), 0),
        hookType: sceneShots[0]?.shortsMetadata?.hookType,
        standaloneSummary: sceneShots[0]?.shortsMetadata?.standaloneSummary,
      }))
      .sort((a, b) => b.viralScore - a.viralScore);
  }, [shots]);

  // Set of scene numbers that are reel candidates (used by filteredShots)
  const candidateSceneNumbers = useMemo(
    () => new Set(shortsCandidateScenes.map((s) => s.sceneNumber)),
    [shortsCandidateScenes],
  );

  // Apply filters
  const filteredShots = useMemo(() => {
    return shots.filter((shot) => {
      if (showShortsOnly && !candidateSceneNumbers.has(shot.sceneNumber))
        return false;
      if (filter.sceneNumber && shot.sceneNumber !== filter.sceneNumber) {
        return false;
      }
      if (filter.status && shot.status !== filter.status) {
        return false;
      }
      if (filter.searchQuery) {
        const query = filter.searchQuery.toLowerCase();
        const matchesPrompt = shot.prompt?.toLowerCase().includes(query);
        const matchesDescription = shot.description
          .toLowerCase()
          .includes(query);
        return matchesPrompt || matchesDescription;
      }
      return true;
    });
  }, [shots, filter, showShortsOnly, candidateSceneNumbers]);

  // Group shots by scene
  const shotsByScene = useMemo(() => {
    const grouped: Record<number, Shot[]> = {};
    filteredShots.forEach((shot) => {
      const sceneNum = shot.sceneNumber;
      if (!grouped[sceneNum]) {
        grouped[sceneNum] = [];
      }
      grouped[sceneNum]!.push(shot);
    });
    return grouped;
  }, [filteredShots]);

  // Stats
  const stats = useMemo(() => {
    const total = shots.length;
    const pending = shots.filter((s) => s.status === 'pending').length;
    const generating = shots.filter((s) => s.status === 'generating').length;
    const completed = shots.filter((s) => s.status === 'completed').length;
    const failed = shots.filter((s) => s.status === 'failed').length;
    const totalDuration = shots.reduce((acc, s) => acc + s.duration, 0);
    // Count candidate SCENES (not shots) for the UI
    const shortsCandidateSceneCount = new Set(
      shots.filter((s) => s.shortsCandidate).map((s) => s.sceneNumber),
    ).size;
    return {
      total,
      pending,
      generating,
      completed,
      failed,
      totalDuration,
      shortsCandidates: shortsCandidateSceneCount,
    };
  }, [shots]);

  const handleGenerateAll = () => {
    const pendingShots = shots.filter((s) => s.status === 'pending');
    if (pendingShots.length === 0) {
      toast.warning('No pending shots to generate');
      return;
    }
    toast.info(`Queued ${pendingShots.length} shots for video generation`);
    // TODO: Integrate with video generation action
  };

  /**
   * Fetch an image as a blob for ZIP inclusion
   */
  const fetchImageAsBlob = async (url: string): Promise<Blob | null> => {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      return await response.blob();
    } catch {
      return null;
    }
  };

  /**
   * Sanitize a name for use as a filename
   */
  const sanitizeName = (name: string): string => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  };

  /**
   * Parse time string to seconds
   * Format: SS:FF where SS=seconds, FF=frames
   */
  const parseTimeToSeconds = (timeStr: string): number => {
    const parts = timeStr.split(':');
    if (parts.length !== 2) return 0;
    const seconds = parseInt(parts[0] ?? '0', 10);
    const frames = parseInt(parts[1] ?? '0', 10);
    return seconds + frames / 100;
  };

  /**
   * Generate prompt.md content for a shot
   * Uses the same assembled format as displayed in the app
   */
  const generatePromptMd = (shot: Shot): string => {
    const metadata = shot.metadata as {
      characters?: string[];
      locations?: string[];
      veoPrompt?: {
        shotLine?: string;
        timeline?: Array<{
          startTime: string;
          endTime: string;
          type: string;
          character?: string | null;
          content: string;
          emotion?: string | null;
        }>;
        audio?: string;
        style?: string;
        avoid?: string;
        fullPrompt?: string;
      };
      referenceImages?: {
        characters: Array<{ name: string; url: string }>;
        locations: Array<{ name: string; url: string }>;
      };
    } | null;

    const veo = metadata?.veoPrompt;
    const shotCharacters = extractCharacters(shot);

    let md = `# Shot ${shot.sceneNumber}.${shot.shotNumber}\n\n`;
    md += `**Duration:** ${shot.duration} seconds\n\n`;

    // Description
    if (shot.description) {
      md += `## Description\n${shot.description}\n\n`;
    }

    // Build assembled VEO prompt (matching what app displays)
    if (veo?.timeline && veo.timeline.length > 0) {
      md += `## VEO Prompt\n\`\`\`\n`;

      // 1. Characters section with descriptions
      // Get character details from project assets
      const charDetails: Array<{ name: string; description: string }> = [];
      for (const charName of shotCharacters) {
        const asset = projectCharacters.find(
          (c) => c.name.toLowerCase() === charName.toLowerCase(),
        );
        if (asset) {
          charDetails.push({
            name: asset.name,
            description: asset.description || asset.name,
          });
        }
      }

      if (charDetails.length > 0) {
        md += 'CHARACTERS:\n';
        for (const char of charDetails) {
          md += `- ${char.name}: ${char.description}\n`;
        }
        md += '(Identify from provided reference images)\n\n';
      } else if (shotCharacters.length > 0) {
        md += `CHARACTERS: ${shotCharacters.join(', ')} (identify from reference images)\n\n`;
      }

      // 2. Shot line (camera info)
      if (veo.shotLine) {
        md += `SHOT: ${veo.shotLine.replace(/^SHOT:\s*/i, '')}\n\n`;
      }

      // 3. Timeline events formatted as [start-end] content (in seconds)
      for (const event of veo.timeline) {
        const startSec = parseTimeToSeconds(event.startTime);
        const endSec = parseTimeToSeconds(event.endTime);

        if (event.type === 'dialogue' && event.character) {
          const emotionPart = event.emotion ? ` (Tone: ${event.emotion})` : '';
          md += `[${startSec}s-${endSec}s] ${event.character}: "${event.content}"${emotionPart}\n`;
        } else {
          md += `[${startSec}s-${endSec}s] ${event.content}\n`;
        }
      }
      md += '\n';

      // 4. Audio section
      if (veo.audio) {
        md += `AUDIO: ${veo.audio}\n\n`;
      }

      // 5. Style section (include project aesthetic style)
      if (veo.style) {
        let styleText = veo.style;
        const projectAesthetic = episode.projectMetadata?.projectAestheticStyle;
        const projectVideoStyle = episode.projectMetadata?.videoStyle;
        if (projectAesthetic) {
          styleText = `${veo.style}. ${projectAesthetic}`;
        } else if (projectVideoStyle) {
          styleText = `${veo.style}. ${projectVideoStyle}`;
        }
        md += `STYLE: ${styleText}\n\n`;
      }

      // 6. Avoid section
      if (veo.avoid) {
        md += `AVOID: ${veo.avoid}\n`;
      }

      md += '```\n\n';
    } else if (shot.prompt) {
      // Fallback to raw prompt if no V2 timeline
      md += `## VEO Prompt\n\`\`\`\n${shot.prompt}\n\`\`\`\n\n`;
    }

    // Reference Images listing
    const refImages = metadata?.referenceImages;
    if (refImages) {
      if (refImages.characters && refImages.characters.length > 0) {
        md += `## Reference Images - Characters\n`;
        for (const char of refImages.characters) {
          md += `- ${char.name} → \`character-${sanitizeName(char.name)}.png\`\n`;
        }
        md += '\n';
      }
      if (refImages.locations && refImages.locations.length > 0) {
        md += `## Reference Images - Locations\n`;
        for (const loc of refImages.locations) {
          md += `- ${loc.name} → \`location-${sanitizeName(loc.name)}.png\`\n`;
        }
        md += '\n';
      }
    }

    // List storyboard frames if present
    if (shot.firstFrameUrl || shot.lastFrameUrl) {
      md += `## Storyboard Frames\n`;
      if (shot.firstFrameUrl) {
        md += `- First frame → \`first-frame.png\`\n`;
      }
      if (shot.lastFrameUrl) {
        md += `- Last frame → \`last-frame.png\`\n`;
      }
      md += '\n';
    }

    return md;
  };

  /**
   * Export all shot data for VEO 3.1 as a structured ZIP
   * Structure: Episode/Scene-X/Shot-X.Y/ with prompt.md and reference images
   */
  const [isExporting, setIsExporting] = useState(false);

  const handleExportVeo = async () => {
    if (shots.length === 0) {
      toast.warning('No shots to export');
      return;
    }

    setIsExporting(true);
    toast.info('Preparing VEO export...');

    try {
      // Dynamic import of JSZip
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      // Group shots by scene
      const shotsBySceneMap: Record<number, Shot[]> = {};
      for (const shot of shots) {
        const sceneNum = shot.sceneNumber;
        if (!shotsBySceneMap[sceneNum]) {
          shotsBySceneMap[sceneNum] = [];
        }
        shotsBySceneMap[sceneNum]!.push(shot);
      }

      // Sort scenes
      const sortedScenes = Object.entries(shotsBySceneMap).sort(
        ([a], [b]) => parseInt(a) - parseInt(b),
      );

      // Track fetched images to avoid duplicates or 429s
      const fetchedAssets = new Map<string, Blob>();

      // Metadata for FCP import
      const fcpMetadata: Array<{
        scene: number;
        shot: number;
        duration: number;
        filename: string;
        characters: string[];
      }> = [];

      for (const [sceneNum, sceneShots] of sortedScenes) {
        const sceneFolder = zip.folder(`Scene-${sceneNum}`);
        if (!sceneFolder) continue;

        // Sort shots within scene
        const sortedShots = [...sceneShots].sort(
          (a, b) => a.shotNumber - b.shotNumber,
        );

        for (const shot of sortedShots) {
          const shotFolder = sceneFolder.folder(
            `Shot-${sceneNum}.${shot.shotNumber}`,
          );
          if (!shotFolder) continue;

          // Add prompt.md
          const promptMd = generatePromptMd(shot);
          shotFolder.file('prompt.md', promptMd);

          // 1. DOWNLOAD VIDEO (Critical for FCP)
          if (shot.videoUrl) {
            let blob = fetchedAssets.get(shot.videoUrl);
            if (!blob) {
              blob = (await fetchImageAsBlob(shot.videoUrl)) ?? undefined;
              if (blob) {
                fetchedAssets.set(shot.videoUrl, blob);
              }
            }
            if (blob) {
              const videoFilename = `shot-${sceneNum}-${shot.shotNumber}.mp4`;
              shotFolder.file(videoFilename, blob);

              fcpMetadata.push({
                scene: Number(sceneNum),
                shot: Number(shot.shotNumber),
                duration: Number(shot.duration),
                filename: videoFilename,
                characters: extractCharacters(shot),
              });
            }
          }

          // Add storyboard frames (first and last frame images)
          if (shot.firstFrameUrl) {
            let blob = fetchedAssets.get(shot.firstFrameUrl);
            if (!blob) {
              blob = (await fetchImageAsBlob(shot.firstFrameUrl)) ?? undefined;
              if (blob) {
                fetchedAssets.set(shot.firstFrameUrl, blob);
              }
            }
            if (blob) {
              shotFolder.file('first-frame.png', blob);
            }
          }

          if (shot.lastFrameUrl) {
            let blob = fetchedAssets.get(shot.lastFrameUrl);
            if (!blob) {
              blob = (await fetchImageAsBlob(shot.lastFrameUrl)) ?? undefined;
              if (blob) {
                fetchedAssets.set(shot.lastFrameUrl, blob);
              }
            }
            if (blob) {
              shotFolder.file('last-frame.png', blob);
            }
          }

          // Get metadata for reference images
          const metadata = shot.metadata as {
            characters?: string[];
            locations?: string[];
            referenceImages?: {
              characters: Array<{ name: string; url: string }>;
              locations: Array<{ name: string; url: string }>;
            };
          } | null;

          // Add character images - specifically for characters in this shot
          const shotCharacters = extractCharacters(shot);
          for (const charName of shotCharacters) {
            let imgUrl: string | undefined;
            
            // 1. Try to find in metadata.referenceImages
            if (metadata?.referenceImages?.characters) {
              const refImg = metadata.referenceImages.characters.find(
                (c) => c.name.toLowerCase() === charName.toLowerCase()
              );
              if (refImg) imgUrl = refImg.url;
            }
            
            // 2. Fallback to project assets
            if (!imgUrl) {
              const asset = projectCharacters.find(
                (c) => c.name.toLowerCase() === charName.toLowerCase()
              );
              if (asset?.fileUrl) imgUrl = asset.fileUrl;
            }

            if (imgUrl) {
              const filename = `character-${sanitizeName(charName)}.png`;
              let blob = fetchedAssets.get(imgUrl);
              if (!blob) {
                blob = (await fetchImageAsBlob(imgUrl)) ?? undefined;
                if (blob) {
                  fetchedAssets.set(imgUrl, blob);
                }
              }
              if (blob) {
                shotFolder.file(filename, blob);
              }
            }
          }

          // Add location images - try metadata.referenceImages first, then fall back to project assets
          if (
            metadata?.referenceImages?.locations &&
            metadata.referenceImages.locations.length > 0
          ) {
            // Use reference images from metadata
            for (const img of metadata.referenceImages.locations) {
              const filename = `location-${sanitizeName(img.name)}.png`;
              let blob = fetchedAssets.get(img.url);
              if (!blob) {
                blob = (await fetchImageAsBlob(img.url)) ?? undefined;
                if (blob) {
                  fetchedAssets.set(img.url, blob);
                }
              }
              if (blob) {
                shotFolder.file(filename, blob);
              }
            }
          } else if (metadata?.locations && metadata.locations.length > 0) {
            // Fall back to looking up locations from project assets
            for (const locName of metadata.locations) {
              const asset = projectLocations.find(
                (l) => l.name.toLowerCase() === locName.toLowerCase(),
              );
              if (asset?.fileUrl) {
                const filename = `location-${sanitizeName(locName)}.png`;
                let blob = fetchedAssets.get(asset.fileUrl);
                if (!blob) {
                  blob = (await fetchImageAsBlob(asset.fileUrl)) ?? undefined;
                  if (blob) {
                    fetchedAssets.set(asset.fileUrl, blob);
                  }
                }
                if (blob) {
                  shotFolder.file(filename, blob);
                }
              }
            }
          }
        }
      }

      // Add Metadata Manifest for FCP automation
      zip.file(
        'fcp-import-manifest.json',
        JSON.stringify(fcpMetadata, null, 2),
      );

      // Generate and download ZIP
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `veo-export-${episode.title.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().split('T')[0]}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(`Exported ${shots.length} shots as structured ZIP`);
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Failed to export VEO data');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="relative h-full">
      {/* Ambient Glow Background Effects */}
      <div className="cinema-glow cinema-glow-indigo pointer-events-none fixed -top-48 -right-48 -z-10 h-96 w-96" />
      <div className="cinema-glow cinema-glow-purple pointer-events-none fixed -bottom-40 -left-40 -z-10 h-80 w-80" />

      {/* Main Content - Full width always */}
      <div className="flex h-full flex-col overflow-hidden">
        {/* Header Bar */}
        <div className="cinema-workspace flex items-center justify-between border-b border-white/5 px-6 py-3">
          <div className="flex items-center gap-4">
            <h2 className="font-semibold text-gray-900 dark:text-white">
              Visual Studio
            </h2>
            <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
              <span>
                {stats.total} shots
              </span>
              <span>•</span>
              <span>~{Math.round(stats.totalDuration / 60)} min</span>
              {stats.shortsCandidates > 0 && (
                <>
                  <span>•</span>
                  <span className="flex items-center gap-1 font-medium text-orange-500">
                    <Flame className="h-3.5 w-3.5" />
                    {stats.shortsCandidates} reel{stats.shortsCandidates === 1 ? '' : 's'}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-xs">
              <span className="cinema-badge cinema-badge-pending">
                {stats.pending} pending
              </span>
              {stats.generating > 0 && (
                <span className="cinema-badge cinema-badge-processing">
                  {stats.generating} generating
                </span>
              )}
              <span className="cinema-badge cinema-badge-complete">
                {stats.completed} completed
              </span>
              {stats.failed > 0 && (
                <span className="cinema-badge cinema-badge-error">
                  {stats.failed} failed
                </span>
              )}
            </div>

            <Button
              variant="outline"
              onClick={handleExportVeo}
              disabled={stats.total === 0 || isExporting}
              className="gap-2"
            >
              {isExporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {isExporting ? 'Exporting...' : 'Export VEO'}
            </Button>

            <Button
              onClick={handleGenerateAll}
              disabled={stats.pending === 0}
              className="btn-cinema-primary gap-2"
            >
              <Play className="h-4 w-4" />
              Generate All Pending
            </Button>
          </div>
        </div>

        {/* Episode Viral Scorecard — Orchestrator analysis */}
        {viralQuality && (
          <div className="border-b border-orange-500/20 bg-orange-500/5 px-6 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <Flame className="h-4 w-4 text-orange-500" />
                  <span className="text-sm font-semibold text-orange-700 dark:text-orange-400">
                    Episode Viral Scorecard
                  </span>
                </div>
                {/* Score ring */}
                <div className="flex items-center gap-1.5">
                  <div
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold',
                      viralQuality.overallScore >= 0.75
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
                        : viralQuality.overallScore >= 0.65
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
                    )}
                  >
                    {Math.round(viralQuality.overallScore * 100)}
                  </div>
                  <Badge
                    variant="secondary"
                    className={cn(
                      'text-xs capitalize',
                      viralQuality.decision === 'pass'
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
                        : viralQuality.decision === 'revised'
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
                    )}
                  >
                    {viralQuality.decision}
                  </Badge>
                  {viralQuality.orchestratorSteps > 0 && (
                    <span className="text-xs text-gray-400">
                      {viralQuality.orchestratorSteps} agent steps
                    </span>
                  )}
                </div>
                {/* Teaser: whyThisWorks — truncated on collapsed */}
                {!viralScorecardExpanded && viralQuality.whyThisWorks && (
                  <p className="line-clamp-1 max-w-xl text-xs text-gray-600 dark:text-gray-400">
                    {viralQuality.whyThisWorks}
                  </p>
                )}
              </div>
              <button
                onClick={() => setViralScorecardExpanded((v) => !v)}
                className="text-xs text-orange-600 hover:text-orange-800 dark:text-orange-400 dark:hover:text-orange-300 flex items-center gap-1"
              >
                {viralScorecardExpanded ? (
                  <><ChevronUp className="h-3.5 w-3.5" /> Collapse</>
                ) : (
                  <><ChevronDown className="h-3.5 w-3.5" /> Expand<Info className="h-3 w-3 ml-0.5" /></>
                )}
              </button>
            </div>

            {/* Expanded content */}
            {viralScorecardExpanded && (
              <div className="mt-3 grid grid-cols-2 gap-4">
                {/* Why it works */}
                {viralQuality.whyThisWorks && (
                  <div className="rounded-lg bg-green-50 p-3 dark:bg-green-950/30">
                    <p className="mb-1 text-xs font-semibold text-green-700 dark:text-green-400">
                      ✓ Why this episode works virally
                    </p>
                    <p className="text-xs leading-relaxed text-green-900 dark:text-green-200">
                      {viralQuality.whyThisWorks}
                    </p>
                  </div>
                )}

                {/* What to improve */}
                {viralQuality.whatToImprove && (
                  <div className="rounded-lg bg-amber-50 p-3 dark:bg-amber-950/30">
                    <p className="mb-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
                      ⚡ What to improve
                    </p>
                    <p className="text-xs leading-relaxed text-amber-900 dark:text-amber-200">
                      {viralQuality.whatToImprove}
                    </p>
                  </div>
                )}

                {/* Dimension bars */}
                {viralQuality.dimensionScores && (
                  <div className="col-span-2 rounded-lg bg-white/50 p-3 dark:bg-white/5">
                    <p className="mb-2 text-xs font-semibold text-gray-600 dark:text-gray-400">
                      7-Dimension Breakdown
                    </p>
                    <div className="grid grid-cols-4 gap-x-4 gap-y-2">
                      {Object.entries(viralQuality.dimensionScores).map(([dim, score]) => (
                        <div key={dim}>
                          <div className="mb-0.5 flex items-center justify-between">
                            <span className="text-xs capitalize text-gray-500 dark:text-gray-400">
                              {dim.replace(/([A-Z])/g, ' $1').trim()}
                            </span>
                            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                              {Math.round((score as number) * 100)}
                            </span>
                          </div>
                          <div className="h-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                            <div
                              className={cn(
                                'h-full rounded-full',
                                (score as number) >= 0.7
                                  ? 'bg-green-500'
                                  : (score as number) >= 0.5
                                    ? 'bg-amber-500'
                                    : 'bg-red-500',
                              )}
                              style={{ width: `${(score as number) * 100}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Top Reel Candidates */}
                {viralQuality.reelCandidates && viralQuality.reelCandidates.length > 0 && (
                  <div className="col-span-2">
                    <p className="mb-1.5 text-xs font-semibold text-gray-600 dark:text-gray-400">
                      🎬 Top Reel Candidates
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {viralQuality.reelCandidates
                        .sort((a, b) => b.viralScore - a.viralScore)
                        .slice(0, 4)
                        .map((c) => (
                          <div
                            key={c.sceneNumber}
                            className="flex items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1 text-xs text-orange-800 dark:bg-orange-900/40 dark:text-orange-300"
                          >
                            <Flame className="h-3 w-3" />
                            <span>Scene {c.sceneNumber}</span>
                            {c.hookType && (
                              <span className="opacity-70 capitalize">· {c.hookType}</span>
                            )}
                            <span className="font-bold">{c.viralScore.toFixed(1)}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {/* Revisions applied */}
                {viralQuality.revisionsApplied && viralQuality.revisionsApplied.length > 0 && (
                  <div className="col-span-2">
                    <p className="mb-1 text-xs font-medium text-blue-600 dark:text-blue-400">
                      🔄 Orchestrator revisions applied
                    </p>
                    <ul className="space-y-0.5">
                      {viralQuality.revisionsApplied.map((r, i) => (
                        <li key={i} className="text-xs text-gray-500 dark:text-gray-400">• {r}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Filters Bar */}
        <div className="flex items-center gap-4 border-b border-white/5 bg-white/[0.02] px-6 py-3 backdrop-blur-sm">
          {/* Search */}
          <div className="relative max-w-xs flex-1">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Filter shots..."
              value={filter.searchQuery ?? ''}
              onChange={(e) =>
                setFilter({
                  ...filter,
                  searchQuery: e.target.value || undefined,
                })
              }
              className="pl-9"
            />
          </div>

          {/* Scene Filter */}
          <Select
            value={filter.sceneNumber?.toString() ?? 'all'}
            onValueChange={(value) =>
              setFilter({
                ...filter,
                sceneNumber: value === 'all' ? undefined : parseInt(value, 10),
              })
            }
          >
            <SelectTrigger className="w-36">
              <Filter className="mr-2 h-4 w-4" />
              <SelectValue placeholder="Scene" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Scenes</SelectItem>
              {sceneNumbers.map((num) => (
                <SelectItem key={num} value={num.toString()}>
                  Scene {num}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Status Filter */}
          <Select
            value={filter.status ?? 'all'}
            onValueChange={(value) =>
              setFilter({
                ...filter,
                status: value === 'all' ? undefined : (value as ShotStatus),
              })
            }
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="generating">Generating</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>

          {/* Shorts Only Toggle */}
          {stats.shortsCandidates > 0 && (
            <button
              onClick={() => setShowShortsOnly((v) => !v)}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all',
                showShortsOnly
                  ? 'border-orange-400 bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-md'
                  : 'border-gray-200 bg-white/5 text-gray-500 hover:border-orange-300 hover:text-orange-500 dark:border-white/10',
              )}
            >
              <Flame className="h-3.5 w-3.5" />
              Shorts Only
            </button>
          )}

          {/* Clear Filters */}
          {(filter.sceneNumber || filter.status || filter.searchQuery) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFilter({})}
              className="text-gray-500"
            >
              <X className="mr-1 h-4 w-4" />
              Clear
            </Button>
          )}
        </div>

        {/* Shorts Candidates Panel — scene-level reel candidates */}
        {shortsCandidateScenes.length > 0 && (
          <div className="border-b border-orange-500/20 bg-gradient-to-r from-orange-950/20 to-red-950/10 px-6 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-orange-400" />
                <span className="text-sm font-semibold text-orange-300">
                  {shortsCandidateScenes.length} Reel{shortsCandidateScenes.length === 1 ? '' : 's'}
                </span>
                <span className="text-xs text-gray-500">
                  — complete scenes flagged by AI as standalone reels (30-60s)
                </span>
              </div>
              <div className="flex items-center gap-2">
                {shortsCandidateScenes.slice(0, 5).map((scene) => (
                  <button
                    key={scene.sceneNumber}
                    onClick={() =>
                      setFilter((f) => ({
                        ...f,
                        sceneNumber:
                          f.sceneNumber === scene.sceneNumber
                            ? undefined
                            : scene.sceneNumber,
                      }))
                    }
                    title={scene.standaloneSummary ?? `Scene ${scene.sceneNumber}`}
                    className="flex items-center gap-1.5 rounded-full border border-orange-500/30 bg-orange-900/30 px-2.5 py-1 text-xs font-medium text-orange-300 transition-all hover:bg-orange-900/50"
                  >
                    <Flame className="h-3 w-3" />
                    Scene {scene.sceneNumber}
                    <span className="text-orange-400/70">·</span>
                    <span className="font-bold text-orange-200">
                      {scene.viralScore}/10
                    </span>
                    <span className="text-orange-500/60">
                      ~{Math.round(scene.estimatedDurationSeconds)}s
                    </span>
                  </button>
                ))}
                {shortsCandidateScenes.length > 5 && (
                  <span className="text-xs text-gray-500">
                    +{shortsCandidateScenes.length - 5} more
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Comic Strip Shot Grid */}
        <div className="flex-1 overflow-y-auto bg-slate-950/50 p-8">
          {Object.entries(shotsByScene).length === 0 ? (
            <div className="flex h-full items-center justify-center text-gray-500 dark:text-gray-400">
              No shots match the current filters
            </div>
          ) : (
            <div className="space-y-12">
              {Object.entries(shotsByScene)
                .sort(([a], [b]) => parseInt(a) - parseInt(b))
                .map(([sceneNum, sceneShots]) => (
                  <div key={sceneNum} className="flex items-start gap-6">
                    {/* Rotated Scene Title */}
                    <div className="scene-title-rotator sticky top-8 flex h-[250px] min-w-[40px] items-center justify-center">
                      Scene {sceneNum}
                    </div>

                    {/* Comic Strip Grid */}
                    <div className="grid flex-1 auto-rows-min grid-cols-2 gap-8 md:grid-cols-3 lg:grid-cols-4">
                      {sceneShots.map((shot, index) => (
                        <ShotCard
                          key={shot.id}
                          shot={shot}
                          size={getShotSize(index)}
                          isSelected={selectedShot?.id === shot.id}
                          onClick={() => setSelectedShot(shot)}
                        />
                      ))}

                      {/* Add New Shot Card */}
                      <div className="liquid-card flex min-h-[200px] cursor-pointer flex-col items-center justify-center border border-dashed border-gray-300 bg-gray-50/50 p-4 text-gray-500 transition-colors hover:bg-gray-100/50 dark:border-white/10 dark:bg-[#1A1A1A] dark:text-[#A3A3A3] dark:hover:bg-[#252525]">
                        <PlusCircle className="mb-2 h-10 w-10" />
                        <span className="text-sm font-medium">
                          Add New Shot
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Fixed Sidebar Overlay */}
      {selectedShot && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-20 bg-black/10"
            onClick={() => setSelectedShot(null)}
          />

          {/* Sidebar */}
          <div className="fixed top-0 right-0 z-30 h-full">
            <ShotDetailsSidebar
              shot={selectedShot}
              projectId={episode.projectId}
              projectVideoStyle={episode.projectMetadata?.videoStyle}
              projectAestheticStyle={
                episode.projectMetadata?.projectAestheticStyle
              }
              characterDetails={(() => {
                // Build characterDetails from project characters matching shot's character names
                const shotMetadata = selectedShot.metadata as
                  | { characters?: string[] }
                  | undefined;
                const shotCharacterNames = shotMetadata?.characters ?? [];

                if (
                  shotCharacterNames.length === 0 ||
                  projectCharacters.length === 0
                ) {
                  return undefined;
                }

                return shotCharacterNames
                  .map((name) => {
                    const asset = projectCharacters.find(
                      (c) => c.name.toLowerCase() === name.toLowerCase(),
                    );
                    if (!asset) return null;
                    return {
                      name: asset.name,
                      description: asset.description || asset.name,
                    };
                  })
                  .filter(
                    (c): c is { name: string; description: string } =>
                      c !== null,
                  );
              })()}
              onClose={() => setSelectedShot(null)}
              onUpdate={refetchEpisode}
            />
          </div>
        </>
      )}
    </div>
  );
}
