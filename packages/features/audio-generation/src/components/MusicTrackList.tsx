'use client';

import * as React from 'react';
import { useState } from 'react';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  Music,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';

import { refusalMessage, unwrap } from '@kit/next/action-result';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@kit/ui/dialog';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
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

import type {
  AudioTrack,
  AudioTrackStatus,
} from '../lib/schemas/audio-track.schema';
import { generateMusicAction } from '../server/actions';
import { deleteAudioTrackAction } from '../server/audio-track-queries';

/**
 * Props for the MusicTrackList component
 */
export interface MusicTrackListProps {
  /** Episode ID for generating new tracks */
  episodeId: string;
  /** List of audio tracks to display */
  tracks: AudioTrack[];
  /** Callback when a track is played */
  onPlay: (audioUrl: string, trackId: string) => void;
  /** Callback when playback is paused */
  onPause: () => void;
  /** ID of the currently playing track */
  playingTrackId?: string | null;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Format duration in seconds to MM:SS
 */
function formatDuration(seconds: number | null): string {
  if (!seconds) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * Get badge variant for track status
 */
function getStatusBadge(status: AudioTrackStatus): React.ReactNode {
  switch (status) {
    case 'pending':
      return (
        <Badge variant="secondary" className="flex items-center gap-1">
          Pending
        </Badge>
      );
    case 'processing':
      return (
        <Badge variant="default" className="flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Generating
        </Badge>
      );
    case 'completed':
      return (
        <Badge
          variant="default"
          className="flex items-center gap-1 bg-green-500"
        >
          Ready
        </Badge>
      );
    case 'failed':
      return (
        <Badge variant="destructive" className="flex items-center gap-1">
          Failed
        </Badge>
      );
    default:
      return null;
  }
}

/**
 * MusicTrackList component for managing episode music tracks
 *
 * Features:
 * - Display list of music tracks with status
 * - Play/pause controls for completed tracks
 * - Add new track dialog with generation options
 * - Delete track functionality
 * - Status badges (pending, generating, completed, failed)
 *
 * @example
 * ```tsx
 * <MusicTrackList
 *   episodeId="uuid-here"
 *   tracks={tracks}
 *   onPlay={(url, id) => playAudio(url)}
 *   onPause={() => pauseAudio()}
 *   playingTrackId={currentTrackId}
 * />
 * ```
 */
export function MusicTrackList({
  episodeId,
  tracks,
  onPlay,
  onPause,
  playingTrackId,
  className,
}: MusicTrackListProps) {
  // Dialog state
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Form state for new track
  const [prompt, setPrompt] = useState('');
  const [genre, setGenre] = useState('');
  const [mood, setMood] = useState('');
  const [tempo, setTempo] = useState<'slow' | 'medium' | 'fast' | ''>('');

  const queryClient = useQueryClient();

  // Generate music mutation
  const generateMutation = useMutation({
    mutationFn: async () => {
      // Build tags array from genre, mood, tempo (filtering empty values)
      const tags = [genre, mood, tempo].filter(
        (t): t is string => !!t && t.trim() !== '',
      );

      return unwrap(
        generateMusicAction({
          episodeId,
          request: {
            prompt,
            duration: 60, // Default 60 second tracks
            genre: genre || undefined,
            mood: mood || undefined,
            tempo: tempo || undefined,
            tags: tags.length > 0 ? tags : undefined,
          },
        }),
      );
    },
    onSuccess: () => {
      toast.success('Music generation started! This may take a few minutes.');
      setIsDialogOpen(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['music-tracks', episodeId] });
    },
    onError: (error: unknown) => {
      toast.error(refusalMessage(error, 'Failed to generate music'));
    },
  });

  // Delete track mutation
  const deleteMutation = useMutation({
    mutationFn: (trackId: string) => deleteAudioTrackAction({ trackId }),
    onSuccess: () => {
      toast.success('Track deleted');
      queryClient.invalidateQueries({ queryKey: ['music-tracks', episodeId] });
    },
    onError: (error: unknown) => {
      toast.error(refusalMessage(error, 'Failed to delete track'));
    },
  });

  const resetForm = () => {
    setPrompt('');
    setGenre('');
    setMood('');
    setTempo('');
  };

  const handlePlay = (track: AudioTrack) => {
    if (!track.fileUrl) return;
    onPlay(track.fileUrl, track.id);
  };

  const handleDelete = (trackId: string) => {
    if (confirm('Are you sure you want to delete this track?')) {
      deleteMutation.mutate(trackId);
    }
  };

  const handleGenerate = () => {
    if (!prompt.trim()) {
      toast.error('Please enter a prompt for the music');
      return;
    }
    generateMutation.mutate();
  };

  // Count tracks by status
  const processingCount = tracks.filter(
    (t) => t.status === 'processing',
  ).length;

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Music Tracks</h3>
          <p className="text-sm text-muted-foreground">
            {tracks.length} track{tracks.length !== 1 ? 's' : ''}
            {processingCount > 0 && (
              <span className="ml-2 text-blue-500">
                ({processingCount} generating)
              </span>
            )}
          </p>
        </div>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-1 h-4 w-4" />
              Add Track
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Generate Music Track</DialogTitle>
              <DialogDescription>
                Describe the background music you want to generate using AI.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Prompt */}
              <div className="space-y-2">
                <Label htmlFor="music-prompt">Prompt</Label>
                <Textarea
                  id="music-prompt"
                  placeholder="Describe the music... e.g., 'Upbeat electronic music with synth melodies and a driving beat'"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={3}
                />
              </div>

              {/* Genre and Mood */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="music-genre">Genre</Label>
                  <Input
                    id="music-genre"
                    placeholder="e.g., Electronic, Jazz"
                    value={genre}
                    onChange={(e) => setGenre(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="music-mood">Mood</Label>
                  <Input
                    id="music-mood"
                    placeholder="e.g., Upbeat, Calm"
                    value={mood}
                    onChange={(e) => setMood(e.target.value)}
                  />
                </div>
              </div>

              {/* Tempo */}
              <div className="space-y-2">
                <Label htmlFor="music-tempo">Tempo</Label>
                <Select
                  value={tempo}
                  onValueChange={(v) =>
                    setTempo(v as 'slow' | 'medium' | 'fast' | '')
                  }
                >
                  <SelectTrigger id="music-tempo">
                    <SelectValue placeholder="Select tempo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Any</SelectItem>
                    <SelectItem value="slow">Slow</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="fast">Fast</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Generate Button */}
              <Button
                className="w-full"
                onClick={handleGenerate}
                disabled={!prompt.trim() || generateMutation.isPending}
              >
                {generateMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Music className="mr-2 h-4 w-4" />
                    Generate Music
                  </>
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Track List */}
      <div className="space-y-2">
        {tracks.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            <Music className="mx-auto mb-3 h-12 w-12 opacity-40" />
            <p className="font-medium">No music tracks yet</p>
            <p className="mt-1 text-sm">
              Add a track to create background music for your episode
            </p>
          </div>
        ) : (
          tracks.map((track) => (
            <div
              key={track.id}
              className={cn(
                'flex items-center gap-3 rounded-lg border p-3 transition-colors',
                playingTrackId === track.id
                  ? 'border-blue-500 bg-blue-50'
                  : 'hover:bg-gray-50',
              )}
              data-testid={`music-track-${track.id}`}
            >
              {/* Play/Pause Button */}
              <Button
                size="icon"
                variant="ghost"
                disabled={!track.fileUrl}
                onClick={() =>
                  playingTrackId === track.id ? onPause() : handlePlay(track)
                }
                aria-label={
                  playingTrackId === track.id ? 'Pause track' : 'Play track'
                }
              >
                {playingTrackId === track.id ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </Button>

              {/* Track Info */}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {track.name || 'Untitled Track'}
                </p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{formatDuration(track.durationSeconds)}</span>
                  {track.metadata?.genre && (
                    <>
                      <span>•</span>
                      <span>{track.metadata.genre}</span>
                    </>
                  )}
                  {track.metadata?.mood && (
                    <>
                      <span>•</span>
                      <span>{track.metadata.mood}</span>
                    </>
                  )}
                </div>
                {track.status === 'failed' && track.metadata?.error && (
                  <p className="mt-1 text-xs text-red-500">
                    Error: {track.metadata.error}
                  </p>
                )}
              </div>

              {/* Status Badge */}
              {getStatusBadge(track.status)}

              {/* Actions */}
              <div className="flex items-center gap-1">
                {track.status === 'failed' && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-blue-500"
                    aria-label="Retry generation"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-muted-foreground hover:text-red-500"
                  onClick={() => handleDelete(track.id)}
                  disabled={deleteMutation.isPending}
                  aria-label="Delete track"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
