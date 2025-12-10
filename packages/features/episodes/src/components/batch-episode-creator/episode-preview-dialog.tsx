'use client';

import { useState } from 'react';

import {
  ArrowDown,
  ArrowUp,
  Check,
  Edit2,
  Loader2,
  Trash2,
  X,
} from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
import { Input } from '@kit/ui/input';
import { ScrollArea } from '@kit/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';
import { Textarea } from '@kit/ui/textarea';

import type {
  ArcPosition,
  EpisodeOutline,
} from '../../lib/schemas/batch-episode.schema';

interface EpisodePreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  episodes: EpisodeOutline[];
  onEpisodesChange: (episodes: EpisodeOutline[]) => void;
  onConfirm: () => void;
  isPending: boolean;
}

const ARC_POSITION_COLORS: Record<ArcPosition, string> = {
  setup: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  rising: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  midpoint: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
  climax: 'bg-red-500/10 text-red-600 border-red-500/20',
  resolution: 'bg-green-500/10 text-green-600 border-green-500/20',
};

const ARC_POSITION_LABELS: Record<ArcPosition, string> = {
  setup: 'Setup',
  rising: 'Rising',
  midpoint: 'Midpoint',
  climax: 'Climax',
  resolution: 'Resolution',
};

export function EpisodePreviewDialog({
  open,
  onOpenChange,
  episodes,
  onEpisodesChange,
  onConfirm,
  isPending,
}: EpisodePreviewDialogProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<{ title: string; premise: string }>({
    title: '',
    premise: '',
  });

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const newEpisodes = [...episodes];
    [newEpisodes[index - 1], newEpisodes[index]] = [
      newEpisodes[index]!,
      newEpisodes[index - 1]!,
    ];
    // Update episode numbers
    const renumbered = newEpisodes.map((ep, i) => ({
      ...ep,
      number: episodes[0]!.number + i,
    }));
    onEpisodesChange(renumbered);
  };

  const handleMoveDown = (index: number) => {
    if (index === episodes.length - 1) return;
    const newEpisodes = [...episodes];
    [newEpisodes[index], newEpisodes[index + 1]] = [
      newEpisodes[index + 1]!,
      newEpisodes[index]!,
    ];
    // Update episode numbers
    const renumbered = newEpisodes.map((ep, i) => ({
      ...ep,
      number: episodes[0]!.number + i,
    }));
    onEpisodesChange(renumbered);
  };

  const handleDelete = (index: number) => {
    const newEpisodes = episodes.filter((_, i) => i !== index);
    // Renumber episodes
    const renumbered = newEpisodes.map((ep, i) => ({
      ...ep,
      number: episodes[0]!.number + i,
    }));
    onEpisodesChange(renumbered);
  };

  const handleStartEdit = (index: number) => {
    const episode = episodes[index];
    if (episode) {
      setEditForm({ title: episode.title, premise: episode.premise });
      setEditingIndex(index);
    }
  };

  const handleSaveEdit = () => {
    if (editingIndex === null) return;
    const newEpisodes = [...episodes];
    const episode = newEpisodes[editingIndex];
    if (episode) {
      newEpisodes[editingIndex] = {
        ...episode,
        title: editForm.title,
        premise: editForm.premise,
      };
      onEpisodesChange(newEpisodes);
    }
    setEditingIndex(null);
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    setEditForm({ title: '', premise: '' });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Review Episode Outlines</DialogTitle>
          <DialogDescription>
            Review and edit the generated episode outlines before creating them.
            You can reorder, edit, or remove episodes.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[60px]">#</TableHead>
                <TableHead>Title</TableHead>
                <TableHead className="hidden md:table-cell">Premise</TableHead>
                <TableHead className="w-[100px]">Arc</TableHead>
                <TableHead className="w-[140px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {episodes.map((episode, index) => (
                <TableRow key={`episode-${episode.number}-${index}`}>
                  <TableCell className="font-medium">
                    {episode.number}
                  </TableCell>
                  <TableCell>
                    {editingIndex === index ? (
                      <Input
                        value={editForm.title}
                        onChange={(e) =>
                          setEditForm({ ...editForm, title: e.target.value })
                        }
                        className="h-8"
                      />
                    ) : (
                      <span className="font-medium">{episode.title}</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden max-w-[300px] md:table-cell">
                    {editingIndex === index ? (
                      <Textarea
                        value={editForm.premise}
                        onChange={(e) =>
                          setEditForm({ ...editForm, premise: e.target.value })
                        }
                        className="min-h-[60px] resize-none text-sm"
                      />
                    ) : (
                      <span className="text-muted-foreground line-clamp-2 text-sm">
                        {episode.premise}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={ARC_POSITION_COLORS[episode.arcPosition]}
                    >
                      {ARC_POSITION_LABELS[episode.arcPosition]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {editingIndex === index ? (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={handleSaveEdit}
                          >
                            <Check className="h-4 w-4 text-green-600" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={handleCancelEdit}
                          >
                            <X className="h-4 w-4 text-red-600" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleMoveUp(index)}
                            disabled={index === 0}
                          >
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleMoveDown(index)}
                            disabled={index === episodes.length - 1}
                          >
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleStartEdit(index)}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleDelete(index)}
                            disabled={episodes.length <= 1}
                          >
                            <Trash2 className="text-destructive h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isPending || episodes.length === 0}
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating Episodes...
              </>
            ) : (
              <>Create {episodes.length} Episodes</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
