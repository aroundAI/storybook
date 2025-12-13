'use client';

import { useCallback, useMemo, useState, useTransition } from 'react';

import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Filter, ListOrdered, Loader2, Play, Search } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Checkbox } from '@kit/ui/checkbox';
import { Input } from '@kit/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { toast } from '@kit/ui/sonner';
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';

import type { EpisodeWithShots, Shot, ShotStatus } from '../../lib/types';
import { reorderShotsAction } from '../../lib/server/mutations/shot-actions';
import { generateShotListAction } from '../../lib/server/mutations/shot-list-actions';
import { useStoryStudioContext } from '../story-studio/story-studio-context';
import { ShotRow } from './shot-row';

interface ShotListEditorProps {
  episode: EpisodeWithShots;
  onGenerateVideos?: (shotIds: string[]) => void;
}

interface ShotFilter {
  sceneNumber?: number;
  status?: ShotStatus;
  searchQuery?: string;
}

export function ShotListEditor({
  episode,
  onGenerateVideos,
}: ShotListEditorProps) {
  const { refetchEpisode } = useStoryStudioContext();
  const [shots, setShots] = useState<Shot[]>(episode.shots);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<ShotFilter>({});
  const [_isReordering, startReorderTransition] = useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

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

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      if (over && active.id !== over.id) {
        setShots((items) => {
          const oldIndex = items.findIndex((item) => item.id === active.id);
          const newIndex = items.findIndex((item) => item.id === over.id);
          const newOrder = arrayMove(items, oldIndex, newIndex);

          // Persist the new order to the database
          startReorderTransition(async () => {
            try {
              await reorderShotsAction({
                episodeId: episode.id,
                shotIds: newOrder.map((s) => s.id),
              });
              toast.success('Shot order saved');
              refetchEpisode();
            } catch {
              toast.error('Failed to save shot order');
            }
          });

          return newOrder;
        });
      }
    },
    [episode.id, refetchEpisode],
  );

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        setSelectedIds(new Set(filteredShots.map((s) => s.id)));
      } else {
        setSelectedIds(new Set());
      }
    },
    [filteredShots],
  );

  const handleSelectShot = useCallback((shotId: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);

      if (selected) {
        next.add(shotId);
      } else {
        next.delete(shotId);
      }

      return next;
    });
  }, []);

  const handleGenerateSelected = useCallback(() => {
    if (selectedIds.size === 0) {
      toast.warning('No shots selected');

      return;
    }

    onGenerateVideos?.(Array.from(selectedIds));
    toast.info(`Queued ${selectedIds.size} shots for generation`);
  }, [selectedIds, onGenerateVideos]);

  const handleGenerateAll = useCallback(() => {
    const pendingShots = shots.filter((s) => s.status === 'pending');

    if (pendingShots.length === 0) {
      toast.warning('No pending shots to generate');

      return;
    }

    onGenerateVideos?.(pendingShots.map((s) => s.id));
    toast.info(`Queued ${pendingShots.length} shots for generation`);
  }, [shots, onGenerateVideos]);

  const allSelected =
    filteredShots.length > 0 && selectedIds.size === filteredShots.length;
  // const someSelected =
  //   selectedIds.size > 0 && selectedIds.size < filteredShots.length;

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

  // Handle generating shot list (first time)
  const handleGenerateShotList = () => {
    // Only allow generation if we have a screenplay
    if (!episode.screenplayData?.scenes?.length) {
      toast.error('Screenplay required to generate shot list');
      return;
    }

    startReorderTransition(async () => {
      try {
        const result = await generateShotListAction({
          episodeId: episode.id,
          // Defaults
          shotDurationMin: 3,
          shotDurationMax: 8,
          videoProvider: 'kling',
        });

        if (result.success) {
          toast.success(`Generated ${result.shotsCreated} shots`);
          refetchEpisode();
        }
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : 'Failed to generate shot list',
        );
      }
    });
  };

  if (shots.length === 0) {
    return (
      <Card className="mt-4">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ListOrdered className="h-5 w-5" />
            <CardTitle>Shot List</CardTitle>
          </div>
          <CardDescription>
            Generate a shot list from the approved screenplay
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <ListOrdered className="text-muted-foreground mb-4 h-12 w-12" />
            <h3 className="mb-2 text-lg font-semibold">
              Ready to Generate Shot List
            </h3>
            <p className="text-muted-foreground mb-6 max-w-md text-sm">
              We&apos;ll analyze your screenplay and break it down into individual
              shots optimized for AI video generation. Each shot will have a detailed
              visual prompt.
            </p>

            <Button onClick={handleGenerateShotList} disabled={_isReordering}>
              {_isReordering ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating Shots...
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  Generate Shot List
                </>
              )}
            </Button>
            <p className="text-muted-foreground mt-4 text-xs">
              Estimated duration: ~45 seconds
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ListOrdered className="h-5 w-5" />
            <div>
              <CardTitle>Shot List</CardTitle>
              <CardDescription>
                {stats.total} shots - ~{Math.round(stats.totalDuration / 60)}{' '}
                min total
              </CardDescription>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleGenerateSelected}
              disabled={selectedIds.size === 0}
            >
              <Play className="mr-2 h-4 w-4" />
              Generate Selected ({selectedIds.size})
            </Button>
            <Button onClick={handleGenerateAll}>
              <Play className="mr-2 h-4 w-4" />
              Generate All Pending ({stats.pending})
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Stats */}
        <div className="mb-4 flex gap-2">
          <Badge variant="outline">Pending: {stats.pending}</Badge>
          <Badge variant="secondary">Generating: {stats.generating}</Badge>
          <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
            Completed: {stats.completed}
          </Badge>
          {stats.failed > 0 && (
            <Badge variant="destructive">Failed: {stats.failed}</Badge>
          )}
        </div>

        {/* Filters */}
        <div className="mb-4 flex flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <Search className="text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search shots..."
              value={filter.searchQuery ?? ''}
              onChange={(e) =>
                setFilter({
                  ...filter,
                  searchQuery: e.target.value || undefined,
                })
              }
              className="w-64"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="text-muted-foreground h-4 w-4" />
            <Select
              value={filter.sceneNumber?.toString() ?? 'all'}
              onValueChange={(value) =>
                setFilter({
                  ...filter,
                  sceneNumber:
                    value === 'all' ? undefined : parseInt(value, 10),
                })
              }
            >
              <SelectTrigger className="w-32">
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

            <Select
              value={filter.status ?? 'all'}
              onValueChange={(value) =>
                setFilter({
                  ...filter,
                  status: value === 'all' ? undefined : (value as ShotStatus),
                })
              }
            >
              <SelectTrigger className="w-32">
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
          </div>
        </div>

        {/* Shot Table */}
        <div className="space-y-8">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            {Object.entries(
              filteredShots.reduce((acc, shot) => {
                const key = shot.sceneNumber;
                if (!acc[key]) acc[key] = [];
                acc[key].push(shot);
                return acc;
              }, {} as Record<number, Shot[]>)
            ).map(([sceneNum, sceneShots]) => (
              <div key={sceneNum} className="space-y-4">
                <div className="flex items-center gap-2 px-2">
                  <h3 className="text-sm font-semibold text-muted-foreground">SCENE {sceneNum}</h3>
                  <div className="h-px flex-1 bg-border/50" />
                  <Badge variant="outline" className="text-xs font-normal">
                    {sceneShots.length} shots
                  </Badge>
                </div>

                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-10">
                          <Checkbox
                            // Scene-level select all could go here, or global
                            // For now keeping simpler global select or individual
                            checked={sceneShots.every(s => selectedIds.has(s.id))}
                            onCheckedChange={(checked) => {
                              const ids = new Set(selectedIds);
                              sceneShots.forEach(s => {
                                if (checked) ids.add(s.id);
                                else ids.delete(s.id);
                              });
                              setSelectedIds(ids);
                            }}
                          />
                        </TableHead>
                        <TableHead className="w-10"></TableHead>
                        <TableHead className="w-16">#</TableHead>
                        <TableHead className="w-24">Status</TableHead>
                        <TableHead className="w-20">Dur</TableHead>
                        <TableHead>Visual Prompt</TableHead>
                        <TableHead className="w-24">Angle</TableHead>
                        <TableHead className="w-24">Move</TableHead>
                        <TableHead className="w-24">Preview</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <SortableContext
                        items={sceneShots.map((s) => s.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        {sceneShots.map((shot) => (
                          <ShotRow
                            key={shot.id}
                            shot={shot}
                            isSelected={selectedIds.has(shot.id)}
                            onSelect={(selected) =>
                              handleSelectShot(shot.id, selected)
                            }
                            onUpdate={refetchEpisode}
                          />
                        ))}
                      </SortableContext>
                    </TableBody>
                  </Table>
                </div>
              </div>
            ))}
          </DndContext>
        </div>

        {filteredShots.length === 0 && (
          <div className="text-muted-foreground py-8 text-center">
            No shots match the current filters
          </div>
        )}
      </CardContent>
    </Card>
  );
}
