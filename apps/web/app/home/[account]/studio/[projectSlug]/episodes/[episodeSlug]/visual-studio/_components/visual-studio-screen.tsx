'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';

import { Download, Filter, Loader2, Play, PlusCircle, Search, X } from 'lucide-react';

import { useAssets } from '@kit/assets/hooks';
import type { EpisodeWithShots, Shot, ShotStatus } from '@kit/episodes/types';
import { Button } from '@kit/ui/button';
import { Input } from '@kit/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { toast } from '@kit/ui/sonner';

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

export function VisualStudioScreen({
  episode,
  refetchEpisode,
}: VisualStudioScreenProps) {
  const [_isPending, _startTransition] = useTransition();
  const [filter, setFilter] = useState<ShotFilter>({});
  const [selectedShot, setSelectedShot] = useState<Shot | null>(null);

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
  const { assets: projectCharacters, fetchAssets: fetchCharacters } = useAssets({
    projectId: episode.projectId,
    type: 'character',
    limit: 100,
  });

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

  // Apply filters
  const filteredShots = useMemo(() => {
    return shots.filter((shot) => {
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
  }, [shots, filter]);

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
    return { total, pending, generating, completed, failed, totalDuration };
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
   * Generate prompt.md content for a shot
   */
  const generatePromptMd = (shot: Shot): string => {
    const metadata = shot.metadata as {
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
        // Legacy V1 format fields
        subject?: string;
        action?: string;
        scene?: string;
        dialogue?: string;
        sounds?: string;
        negativePrompt?: string;
      };
      referenceImages?: {
        characters: Array<{ name: string; url: string }>;
        locations: Array<{ name: string; url: string }>;
      };
    } | null;

    const veo = metadata?.veoPrompt;
    const refImages = metadata?.referenceImages;

    let md = `# Shot ${shot.sceneNumber}.${shot.shotNumber}\n\n`;
    md += `**Duration:** ${shot.duration} seconds\n\n`;

    // Description
    if (shot.description) {
      md += `## Description\n${shot.description}\n\n`;
    }

    // Full VEO Prompt
    if (veo?.fullPrompt) {
      md += `## VEO Prompt\n\`\`\`\n${veo.fullPrompt}\n\`\`\`\n\n`;
    } else if (shot.prompt) {
      md += `## Prompt\n\`\`\`\n${shot.prompt}\n\`\`\`\n\n`;
    }

    // V2 Timeline format
    if (veo?.timeline && veo.timeline.length > 0) {
      md += `## Timeline\n`;
      for (const event of veo.timeline) {
        const char = event.character ? ` [${event.character}]` : '';
        const emotion = event.emotion ? ` *(${event.emotion})*` : '';
        md += `- **${event.startTime}-${event.endTime}** (${event.type})${char}: ${event.content}${emotion}\n`;
      }
      md += '\n';
    }

    // Shot Line (V2)
    if (veo?.shotLine) {
      md += `## Shot Line\n${veo.shotLine}\n\n`;
    }

    // Style
    if (veo?.style) {
      md += `## Style\n${veo.style}\n\n`;
    }

    // Audio
    if (veo?.audio) {
      md += `## Audio\n${veo.audio}\n\n`;
    } else if (veo?.sounds) {
      md += `## Sounds\n${veo.sounds}\n\n`;
    }

    // Avoid / Negative Prompt
    if (veo?.avoid) {
      md += `## Avoid\n${veo.avoid}\n\n`;
    } else if (veo?.negativePrompt) {
      md += `## Negative Prompt\n${veo.negativePrompt}\n\n`;
    }

    // Reference Images listing
    if (refImages) {
      if (refImages.characters && refImages.characters.length > 0) {
        md += `## Characters\n`;
        for (const char of refImages.characters) {
          md += `- ${char.name} → \`character-${sanitizeName(char.name)}.png\`\n`;
        }
        md += '\n';
      }
      if (refImages.locations && refImages.locations.length > 0) {
        md += `## Locations\n`;
        for (const loc of refImages.locations) {
          md += `- ${loc.name} → \`location-${sanitizeName(loc.name)}.png\`\n`;
        }
        md += '\n';
      }
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
        ([a], [b]) => parseInt(a) - parseInt(b)
      );

      // Track fetched images to avoid duplicates
      const fetchedImages = new Map<string, Blob>();

      for (const [sceneNum, sceneShots] of sortedScenes) {
        const sceneFolder = zip.folder(`Scene-${sceneNum}`);
        if (!sceneFolder) continue;

        // Sort shots within scene
        const sortedShots = [...sceneShots].sort(
          (a, b) => a.shotNumber - b.shotNumber
        );

        for (const shot of sortedShots) {
          const shotFolder = sceneFolder.folder(
            `Shot-${sceneNum}.${shot.shotNumber}`
          );
          if (!shotFolder) continue;

          // Add prompt.md
          const promptMd = generatePromptMd(shot);
          shotFolder.file('prompt.md', promptMd);

          // Add storyboard frames (first and last frame images)
          if (shot.firstFrameUrl) {
            let blob = fetchedImages.get(shot.firstFrameUrl);
            if (!blob) {
              blob = (await fetchImageAsBlob(shot.firstFrameUrl)) ?? undefined;
              if (blob) {
                fetchedImages.set(shot.firstFrameUrl, blob);
              }
            }
            if (blob) {
              shotFolder.file('first-frame.png', blob);
            }
          }

          if (shot.lastFrameUrl) {
            let blob = fetchedImages.get(shot.lastFrameUrl);
            if (!blob) {
              blob = (await fetchImageAsBlob(shot.lastFrameUrl)) ?? undefined;
              if (blob) {
                fetchedImages.set(shot.lastFrameUrl, blob);
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

          // Add character images - try metadata.referenceImages first, then fall back to project assets
          if (metadata?.referenceImages?.characters && metadata.referenceImages.characters.length > 0) {
            // Use reference images from metadata
            for (const img of metadata.referenceImages.characters) {
              const filename = `character-${sanitizeName(img.name)}.png`;
              let blob = fetchedImages.get(img.url);
              if (!blob) {
                blob = (await fetchImageAsBlob(img.url)) ?? undefined;
                if (blob) {
                  fetchedImages.set(img.url, blob);
                }
              }
              if (blob) {
                shotFolder.file(filename, blob);
              }
            }
          } else if (metadata?.characters && metadata.characters.length > 0) {
            // Fall back to looking up characters from project assets
            for (const charName of metadata.characters) {
              const asset = projectCharacters.find(
                (c) => c.name.toLowerCase() === charName.toLowerCase()
              );
              if (asset?.fileUrl) {
                const filename = `character-${sanitizeName(charName)}.png`;
                let blob = fetchedImages.get(asset.fileUrl);
                if (!blob) {
                  blob = (await fetchImageAsBlob(asset.fileUrl)) ?? undefined;
                  if (blob) {
                    fetchedImages.set(asset.fileUrl, blob);
                  }
                }
                if (blob) {
                  shotFolder.file(filename, blob);
                }
              }
            }
          }

          // Add location images - try metadata.referenceImages first, then fall back to project assets
          if (metadata?.referenceImages?.locations && metadata.referenceImages.locations.length > 0) {
            // Use reference images from metadata
            for (const img of metadata.referenceImages.locations) {
              const filename = `location-${sanitizeName(img.name)}.png`;
              let blob = fetchedImages.get(img.url);
              if (!blob) {
                blob = (await fetchImageAsBlob(img.url)) ?? undefined;
                if (blob) {
                  fetchedImages.set(img.url, blob);
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
                (l) => l.name.toLowerCase() === locName.toLowerCase()
              );
              if (asset?.fileUrl) {
                const filename = `location-${sanitizeName(locName)}.png`;
                let blob = fetchedImages.get(asset.fileUrl);
                if (!blob) {
                  blob = (await fetchImageAsBlob(asset.fileUrl)) ?? undefined;
                  if (blob) {
                    fetchedImages.set(asset.fileUrl, blob);
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
      {/* Main Content - Full width always */}
      <div className="flex h-full flex-col overflow-hidden">
        {/* Header Bar */}
        <div className="flex items-center justify-between border-b border-black/5 bg-white/85 px-6 py-3 backdrop-blur-xl dark:border-white/5 dark:bg-gray-800/85">
          <div className="flex items-center gap-4">
            <h2 className="font-semibold text-gray-900 dark:text-white">
              Visual Studio
            </h2>
            <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
              <span>{stats.total} shots</span>
              <span>•</span>
              <span>~{Math.round(stats.totalDuration / 60)} min</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-xs">
              <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                {stats.pending} pending
              </span>
              {stats.generating > 0 && (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                  {stats.generating} generating
                </span>
              )}
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                {stats.completed} completed
              </span>
              {stats.failed > 0 && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-700 dark:bg-red-900/30 dark:text-red-400">
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
              className="gap-2 bg-blue-600 text-white shadow-lg shadow-blue-500/20 hover:bg-blue-700"
            >
              <Play className="h-4 w-4" />
              Generate All Pending
            </Button>
          </div>
        </div>

        {/* Filters Bar */}
        <div className="flex items-center gap-4 border-b border-black/5 bg-white/50 px-6 py-3 backdrop-blur-sm dark:border-white/5 dark:bg-gray-800/50">
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

        {/* Comic Strip Shot Grid */}
        <div className="flex-1 overflow-y-auto p-8">
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
                      <div className="liquid-card flex min-h-[200px] cursor-pointer flex-col items-center justify-center border border-dashed border-gray-300 bg-gray-50/50 p-4 text-gray-500 transition-colors hover:bg-gray-100/50 dark:border-gray-600 dark:bg-gray-800/50 dark:hover:bg-gray-700/50">
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
              projectAestheticStyle={episode.projectMetadata?.projectAestheticStyle}
              characterDetails={(() => {
                // Build characterDetails from project characters matching shot's character names
                const shotMetadata = selectedShot.metadata as { characters?: string[] } | undefined;
                const shotCharacterNames = shotMetadata?.characters ?? [];

                if (shotCharacterNames.length === 0 || projectCharacters.length === 0) {
                  return undefined;
                }

                return shotCharacterNames
                  .map((name) => {
                    const asset = projectCharacters.find(
                      (c) => c.name.toLowerCase() === name.toLowerCase()
                    );
                    if (!asset) return null;
                    return {
                      name: asset.name,
                      description: asset.description || asset.name,
                    };
                  })
                  .filter((c): c is { name: string; description: string } => c !== null);
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
