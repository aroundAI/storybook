'use client';

import { useCallback, useState } from 'react';

import { Download, FileText, Loader2 } from 'lucide-react';

import { getSupabaseBrowserClient } from '@kit/supabase/browser-client';
import { Button } from '@kit/ui/button';
import { Checkbox } from '@kit/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@kit/ui/dialog';
import { Label } from '@kit/ui/label';
import { toast } from '@kit/ui/sonner';
import { cn } from '@kit/ui/utils';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

interface SeasonOption {
  id: string;
  number: number;
  name: string | null;
}

interface ExportContentDialogProps {
  projectId: string;
  projectName: string;
  seasons: SeasonOption[];
}

type ExportScope = 'story' | 'screenplay' | 'both';

interface ScreenplayDialogueLine {
  character: string;
  text: string;
  parenthetical?: string;
}

interface ScreenplayScene {
  number: number;
  heading: string;
  location?: string;
  timeOfDay?: string;
  description: string;
  dialogue: ScreenplayDialogueLine[];
  estimatedDuration?: number;
}

interface StoryData {
  title?: string;
  logline?: string;
  fullStory?: string;
  actBreakdown?: { act1: string; act2: string; act3: string };
  characters?: Array<{ name: string; role: string; arc: string }>;
  themes?: string[];
  tone?: string;
}

interface ScreenplayData {
  scenes: ScreenplayScene[];
  metadata?: {
    totalScenes: number;
    estimatedDuration: number;
    locations: string[];
    characters: string[];
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Markdown Formatters
// ────────────────────────────────────────────────────────────────────────────

function formatStoryMd(story: StoryData): string {
  const parts: string[] = [];

  if (story.logline) {
    parts.push(`> ${story.logline}`);
    parts.push('');
  }

  if (story.themes?.length) {
    parts.push(`**Themes:** ${story.themes.join(', ')}`);
  }
  if (story.tone) {
    parts.push(`**Tone:** ${story.tone}`);
  }
  if (story.themes?.length || story.tone) {
    parts.push('');
  }

  if (story.actBreakdown) {
    parts.push('#### Act Structure');
    parts.push('');
    parts.push(`**Act 1:** ${story.actBreakdown.act1}`);
    parts.push('');
    parts.push(`**Act 2:** ${story.actBreakdown.act2}`);
    parts.push('');
    parts.push(`**Act 3:** ${story.actBreakdown.act3}`);
    parts.push('');
  }

  if (story.characters?.length) {
    parts.push('#### Characters');
    parts.push('');
    for (const char of story.characters) {
      parts.push(`- **${char.name}** (${char.role}): ${char.arc}`);
    }
    parts.push('');
  }

  if (story.fullStory) {
    parts.push('#### Full Story');
    parts.push('');
    parts.push(story.fullStory);
    parts.push('');
  }

  return parts.join('\n');
}

function formatScreenplayMd(screenplay: ScreenplayData): string {
  const parts: string[] = [];

  if (screenplay.metadata) {
    const m = screenplay.metadata;
    parts.push(
      `*${m.totalScenes} scenes · ~${Math.round(m.estimatedDuration / 60)} min · ${m.characters.length} characters · ${m.locations.length} locations*`,
    );
    parts.push('');
  }

  for (const scene of screenplay.scenes) {
    parts.push(`#### Scene ${scene.number}: ${scene.heading}`);
    parts.push('');

    if (scene.description) {
      parts.push(`*${scene.description}*`);
      parts.push('');
    }

    if (scene.dialogue?.length) {
      for (const line of scene.dialogue) {
        const paren = line.parenthetical ? ` *(${line.parenthetical})*` : '';
        parts.push(`**${line.character}**${paren}: "${line.text}"`);
        parts.push('');
      }
    }

    parts.push('---');
    parts.push('');
  }

  return parts.join('\n');
}

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

export function ExportContentDialog({
  projectId,
  projectName,
  seasons,
}: ExportContentDialogProps) {
  const [open, setOpen] = useState(false);
  const [selectedSeasons, setSelectedSeasons] = useState<Set<string>>(new Set());
  const [exportScope, setExportScope] = useState<ExportScope>('both');
  const [isExporting, setIsExporting] = useState(false);

  const toggleSeason = useCallback((seasonId: string) => {
    setSelectedSeasons((prev) => {
      const next = new Set(prev);
      if (next.has(seasonId)) {
        next.delete(seasonId);
      } else {
        next.add(seasonId);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedSeasons(new Set(seasons.map((s) => s.id)));
  }, [seasons]);

  const deselectAll = useCallback(() => {
    setSelectedSeasons(new Set());
  }, []);

  const handleExport = useCallback(async () => {
    if (selectedSeasons.size === 0) {
      toast.error('Select at least one season');
      return;
    }

    setIsExporting(true);

    try {
      const client = getSupabaseBrowserClient();

      // Fetch episodes for selected seasons with story + screenplay data
      const seasonIds = Array.from(selectedSeasons);
      const { data: episodes, error } = await client
        .from('episodes')
        .select(
          'id, number, title, season_id, story_data, screenplay_data, status',
        )
        .eq('project_id', projectId)
        .in('season_id', seasonIds)
        .is('deleted_at', null)
        .order('number', { ascending: true });

      if (error) throw new Error(error.message);
      if (!episodes?.length) {
        toast.warning('No episodes found in selected seasons');
        setIsExporting(false);
        return;
      }

      // Group by season
      const seasonMap = new Map<string, typeof episodes>();
      for (const ep of episodes) {
        if (!ep.season_id) continue;
        const list = seasonMap.get(ep.season_id) ?? [];
        list.push(ep);
        seasonMap.set(ep.season_id, list);
      }

      // Build ordered season list
      const orderedSeasons = seasons
        .filter((s) => selectedSeasons.has(s.id))
        .sort((a, b) => a.number - b.number);

      // Build markdown
      const md: string[] = [];
      md.push(`# ${projectName}`);
      md.push('');
      md.push(
        `*Exported ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}*`,
      );
      md.push('');
      md.push('---');
      md.push('');

      for (const season of orderedSeasons) {
        const seasonEpisodes = seasonMap.get(season.id) ?? [];
        if (seasonEpisodes.length === 0) continue;

        const seasonLabel = season.name
          ? `Season ${season.number}: ${season.name}`
          : `Season ${season.number}`;

        md.push(`## ${seasonLabel}`);
        md.push('');

        for (const ep of seasonEpisodes) {
          md.push(`### Episode ${ep.number} — ${ep.title}`);
          md.push('');

          const storyData = ep.story_data as StoryData | null;
          const screenplayData = ep.screenplay_data as ScreenplayData | null;

          const includeStory =
            exportScope === 'story' || exportScope === 'both';
          const includeScreenplay =
            exportScope === 'screenplay' || exportScope === 'both';

          if (includeStory && storyData?.fullStory) {
            md.push('#### Story');
            md.push('');
            md.push(formatStoryMd(storyData));
          } else if (includeStory) {
            md.push('*No story generated yet.*');
            md.push('');
          }

          if (includeScreenplay && screenplayData?.scenes?.length) {
            md.push('#### Screenplay');
            md.push('');
            md.push(formatScreenplayMd(screenplayData));
          } else if (includeScreenplay) {
            md.push('*No screenplay generated yet.*');
            md.push('');
          }

          md.push('');
        }

        md.push('---');
        md.push('');
      }

      // Generate and download file
      const content = md.join('\n');
      const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      const scopeLabel =
        exportScope === 'both'
          ? 'stories-screenplays'
          : exportScope === 'story'
            ? 'stories'
            : 'screenplays';
      const seasonLabel =
        orderedSeasons.length === seasons.length
          ? 'all-seasons'
          : orderedSeasons.map((s) => `S${s.number}`).join('-');

      const filename = `${projectName.toLowerCase().replace(/\s+/g, '-')}_${seasonLabel}_${scopeLabel}.md`;

      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success(
        `Exported ${episodes.length} episodes from ${orderedSeasons.length} season(s)`,
      );
      setOpen(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Export failed',
      );
    } finally {
      setIsExporting(false);
    }
  }, [selectedSeasons, exportScope, projectId, projectName, seasons]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white"
        >
          <Download className="h-4 w-4" />
          Export
        </Button>
      </DialogTrigger>

      <DialogContent className="border-gray-800 bg-gray-950 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <FileText className="h-5 w-5 text-blue-400" />
            Export Content
          </DialogTitle>
          <DialogDescription className="text-gray-400">
            Export stories and screenplays as Markdown for review.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-4">
          {/* Season Selection */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium text-gray-300">
                Seasons
              </Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={selectAll}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  Select all
                </button>
                <span className="text-gray-600">·</span>
                <button
                  type="button"
                  onClick={deselectAll}
                  className="text-xs text-gray-500 hover:text-gray-400"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-gray-800 bg-gray-900/50 p-2">
              {seasons.map((season) => (
                <label
                  key={season.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-colors',
                    selectedSeasons.has(season.id)
                      ? 'bg-blue-500/10 text-white'
                      : 'text-gray-400 hover:bg-gray-800 hover:text-gray-300',
                  )}
                >
                  <Checkbox
                    checked={selectedSeasons.has(season.id)}
                    onCheckedChange={() => toggleSeason(season.id)}
                    className="border-gray-600 data-[state=checked]:border-blue-500 data-[state=checked]:bg-blue-500"
                  />
                  <span className="text-sm">
                    Season {season.number}
                    {season.name && (
                      <span className="ml-1.5 text-gray-500">
                        {season.name}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>

            {selectedSeasons.size > 0 && (
              <p className="text-xs text-gray-500">
                {selectedSeasons.size} of {seasons.length} selected
              </p>
            )}
          </div>

          {/* Export Scope */}
          <div className="space-y-3">
            <Label className="text-sm font-medium text-gray-300">
              Include
            </Label>
            <div className="flex gap-2">
              {(
                [
                  { value: 'both', label: 'Stories & Screenplays' },
                  { value: 'story', label: 'Stories only' },
                  { value: 'screenplay', label: 'Screenplays only' },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setExportScope(option.value)}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-xs font-medium transition-all',
                    exportScope === option.value
                      ? 'border-blue-500 bg-blue-500/15 text-blue-400'
                      : 'border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            className="text-gray-400 hover:text-white"
          >
            Cancel
          </Button>
          <Button
            onClick={handleExport}
            disabled={selectedSeasons.size === 0 || isExporting}
            className="gap-2 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isExporting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Export as Markdown
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
