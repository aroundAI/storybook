'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';

import { Download, Flame, Loader2, Play } from 'lucide-react';

import { useAssets } from '@kit/assets/hooks';
import {
  type ShotLocalPaths,
  buildOpenClawManifest,
} from '@kit/episodes/lib/openclaw-manifest';
import type {
  EpisodeViralQuality,
  EpisodeWithShots,
  Shot,
} from '@kit/episodes/types';
import { Button } from '@kit/ui/button';
import { useLlmJob } from '@kit/ui/hooks';
import { toast } from '@kit/ui/sonner';

import { FilterBar } from './filter-bar';
import { ShortsPanel } from './shorts-panel';
import type { ShortsCandidateScene } from './shorts-panel';
import { ShotDetailsSidebar } from './shot-details-sidebar';
import { ShotGrid } from './shot-grid';
import {
  EMPTY_SELECTION,
  orderedShotIds,
  selectShot,
} from './shot-selection';
import { ViralScorecard } from './viral-scorecard';
import type { ShotFilter } from './visual-studio-utils';

interface VisualStudioScreenProps {
  episode: EpisodeWithShots;
  refetchEpisode: () => void;
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
  const [selection, setSelection] = useState(EMPTY_SELECTION);
  const [showShortsOnly, setShowShortsOnly] = useState(false);
  const viralQuality = episode.viralQuality as
    | EpisodeViralQuality
    | undefined
    | null;

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

  const selectedShot = shots.find((s) => s.id === selection.primaryId) ?? null;
  const selectedShotIds = useMemo(
    () => new Set(selection.selectedIds),
    [selection.selectedIds],
  );
  const clearSelection = () => setSelection(EMPTY_SELECTION);

  // Get unique scene numbers for filter
  const sceneNumbers = useMemo(() => {
    const numbers = [...new Set(shots.map((s) => s.sceneNumber))];
    return numbers.sort((a, b) => a - b);
  }, [shots]);

  // Scene-level shorts candidates (all shots in a scene share the same decision)
  const shortsCandidateScenes = useMemo<ShortsCandidateScene[]>(() => {
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
          sceneShots.reduce(
            (s, sh) => s + (sh.durationSeconds ?? sh.duration ?? 8),
            0,
          ),
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

    // Shot Intelligence (OpenClaw fields)
    if (
      shot.transitionType ||
      shot.frameStrategy ||
      shot.primarySubject ||
      shot.locationArea
    ) {
      md += `## Shot Intelligence\n\n`;

      if (shot.transitionType) {
        md += `**Transition:** ${shot.transitionType.replace(/_/g, ' ')}\n`;
      }
      if (shot.frameStrategy) {
        md += `**Frame Strategy:** ${shot.frameStrategy.replace(/_/g, ' ')}\n`;
      }
      if (shot.primarySubject) {
        md += `**Primary Subject:** ${shot.primarySubject.name} (${shot.primarySubject.type})\n`;
      }
      if (shot.locationArea) {
        md += `**Location Area:** ${shot.locationArea}\n`;
      }
      md += '\n';

      if (shot.firstFrameDescription) {
        md += `### First Frame Description\n${shot.firstFrameDescription}\n\n`;
      }
      if (shot.lastFrameDescription) {
        md += `### Last Frame Description\n${shot.lastFrameDescription}\n\n`;
      }
      if (shot.locationEnvironmentDescription) {
        md += `### Environment Description\n${shot.locationEnvironmentDescription}\n\n`;
      }
    }

    return md;
  };

  /**
   * Unified export: builds a self-contained ZIP with all assets + OpenClaw manifest.
   * OpenClaw can operate entirely from the extracted ZIP — no network access needed.
   *
   * Structure:
   *   openclaw-manifest.json          ← Full manifest with localPath fields filled
   *   fcp-import-manifest.json        ← FCP automation metadata
   *   Scene-X/Shot-X.Y/prompt.md      ← Human-readable VEO prompt
   *   Scene-X/Shot-X.Y/shot-X-Y.mp4   ← Video (if generated)
   *   Scene-X/Shot-X.Y/first-frame.png
   *   Scene-X/Shot-X.Y/last-frame.png
   *   Scene-X/Shot-X.Y/character-*.png
   *   Scene-X/Shot-X.Y/location-*.png
   */
  const [isExporting, setIsExporting] = useState(false);

  const handleExportPackage = async () => {
    if (shots.length === 0) {
      toast.warning('No shots to export');
      return;
    }

    setIsExporting(true);
    toast.info('Building export package...');

    try {
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

      const sortedScenes = Object.entries(shotsBySceneMap).sort(
        ([a], [b]) => parseInt(a) - parseInt(b),
      );

      // Track fetched assets to avoid duplicate downloads
      const fetchedAssets = new Map<string, Blob>();

      // Track local paths for OpenClaw manifest
      const localPathsMap = new Map<string, ShotLocalPaths>();

      // FCP metadata
      const fcpMetadata: Array<{
        scene: number;
        shot: number;
        duration: number;
        filename: string;
        characters: string[];
        transitionType: string | null;
        frameStrategy: string | null;
        primarySubject: { type: string; name: string } | null;
        locationArea: string | null;
        firstFrameDescription: string | null;
        lastFrameDescription: string | null;
      }> = [];

      for (const [sceneNum, sceneShots] of sortedScenes) {
        const sceneFolder = zip.folder(`Scene-${sceneNum}`);
        if (!sceneFolder) continue;

        const sortedShots = [...sceneShots].sort(
          (a, b) => a.shotNumber - b.shotNumber,
        );

        for (const shot of sortedShots) {
          const shotFolderName = `Shot-${sceneNum}.${shot.shotNumber}`;
          const shotFolder = sceneFolder.folder(shotFolderName);
          if (!shotFolder) continue;

          const shotBasePath = `Scene-${sceneNum}/${shotFolderName}`;

          // Initialize local paths tracker for this shot
          const shotPaths: ShotLocalPaths = {
            characterPaths: new Map<string, string>(),
            locationPath: null,
            firstFramePath: null,
            lastFramePath: null,
            videoPath: null,
          };

          // Add prompt.md
          const promptMd = generatePromptMd(shot);
          shotFolder.file('prompt.md', promptMd);

          // 1. DOWNLOAD VIDEO
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
              shotPaths.videoPath = `${shotBasePath}/${videoFilename}`;

              fcpMetadata.push({
                scene: Number(sceneNum),
                shot: Number(shot.shotNumber),
                duration: Number(shot.duration),
                filename: videoFilename,
                characters: extractCharacters(shot),
                transitionType: shot.transitionType ?? null,
                frameStrategy: shot.frameStrategy ?? null,
                primarySubject: shot.primarySubject ?? null,
                locationArea: shot.locationArea ?? null,
                firstFrameDescription: shot.firstFrameDescription ?? null,
                lastFrameDescription: shot.lastFrameDescription ?? null,
              });
            }
          }

          // 2. FIRST FRAME
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
              shotPaths.firstFramePath = `${shotBasePath}/first-frame.png`;
            }
          }

          // 3. LAST FRAME
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
              shotPaths.lastFramePath = `${shotBasePath}/last-frame.png`;
            }
          }

          // 4. CHARACTER REFERENCE IMAGES
          const metadata = shot.metadata as {
            characters?: string[];
            locations?: string[];
            referenceImages?: {
              characters: Array<{ name: string; url: string }>;
              locations: Array<{ name: string; url: string }>;
            };
          } | null;

          const shotCharacters = extractCharacters(shot);
          for (const charName of shotCharacters) {
            let imgUrl: string | undefined;

            if (metadata?.referenceImages?.characters) {
              const refImg = metadata.referenceImages.characters.find(
                (c) => c.name.toLowerCase() === charName.toLowerCase(),
              );
              if (refImg) imgUrl = refImg.url;
            }

            if (!imgUrl) {
              const asset = projectCharacters.find(
                (c) => c.name.toLowerCase() === charName.toLowerCase(),
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
                shotPaths.characterPaths.set(
                  charName.toLowerCase(),
                  `${shotBasePath}/${filename}`,
                );
              }
            }
          }

          // 5. LOCATION REFERENCE IMAGES
          if (
            metadata?.referenceImages?.locations &&
            metadata.referenceImages.locations.length > 0
          ) {
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
                shotPaths.locationPath = `${shotBasePath}/${filename}`;
              }
            }
          } else if (metadata?.locations && metadata.locations.length > 0) {
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
                  shotPaths.locationPath = `${shotBasePath}/${filename}`;
                }
              }
            }
          }

          // Store paths for this shot
          localPathsMap.set(shot.id, shotPaths);
        }
      }

      // Build OpenClaw manifest with local paths
      const openClawManifest = buildOpenClawManifest(
        episode,
        projectCharacters ?? [],
        projectLocations ?? [],
        localPathsMap,
      );
      zip.file(
        'openclaw-manifest.json',
        JSON.stringify(openClawManifest, null, 2),
      );

      // Add FCP import manifest
      zip.file(
        'fcp-import-manifest.json',
        JSON.stringify(fcpMetadata, null, 2),
      );

      // Generate and download ZIP
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `episode-export-${episode.title.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().split('T')[0]}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(
        `Exported ${shots.length} shots with OpenClaw manifest (${openClawManifest.summary.cutsCount} cuts, ${openClawManifest.summary.continuationsCount} continuations)`,
      );
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Failed to export package');
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
              <span>{stats.total} shots</span>
              <span>•</span>
              <span>~{Math.round(stats.totalDuration / 60)} min</span>
              {stats.shortsCandidates > 0 && (
                <>
                  <span>•</span>
                  <span className="flex items-center gap-1 font-medium text-orange-500">
                    <Flame className="h-3.5 w-3.5" />
                    {stats.shortsCandidates} reel
                    {stats.shortsCandidates === 1 ? '' : 's'}
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
              onClick={handleExportPackage}
              disabled={stats.total === 0 || isExporting}
              className="gap-2"
            >
              {isExporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {isExporting ? 'Exporting...' : 'Export Package'}
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

        {/* Episode Viral Scorecard */}
        {viralQuality && <ViralScorecard viralQuality={viralQuality} />}

        {/* Filters Bar */}
        <FilterBar
          filter={filter}
          setFilter={setFilter}
          sceneNumbers={sceneNumbers}
          showShortsOnly={showShortsOnly}
          setShowShortsOnly={setShowShortsOnly}
          shortsCandidateCount={stats.shortsCandidates}
        />

        {/* Shorts Candidates Panel */}
        <ShortsPanel
          shortsCandidateScenes={shortsCandidateScenes}
          onSceneFilter={(sceneNumber) =>
            setFilter((f) => ({ ...f, sceneNumber }))
          }
          currentSceneFilter={filter.sceneNumber}
        />

        {/* Comic Strip Shot Grid */}
        <div className="flex-1 overflow-y-auto bg-slate-950/50 p-8">
          <ShotGrid
            shotsByScene={shotsByScene}
            selectedShotIds={selectedShotIds}
            onShotSelect={(shot, modifiers) =>
              setSelection((current) =>
                selectShot(
                  current,
                  orderedShotIds(shotsByScene),
                  shot.id,
                  modifiers,
                ),
              )
            }
            onClearSelection={clearSelection}
          />
          {selectedShotIds.size > 1 && (
            <div
              role="status"
              data-test="shot-selection-bar"
              className="sticky bottom-0 mt-6 flex items-center justify-between rounded-lg bg-blue-600 px-4 py-2 text-sm text-white shadow-lg"
            >
              <span>{selectedShotIds.size} shots selected</span>
              <Button
                variant="ghost"
                size="sm"
                data-test="shot-selection-clear"
                className="text-white hover:bg-blue-500 hover:text-white"
                onClick={clearSelection}
              >
                Clear
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Fixed Sidebar Overlay */}
      {selectedShot && (
        <>
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
              onClose={clearSelection}
              onUpdate={refetchEpisode}
            />
          </div>
        </>
      )}
    </div>
  );
}
