'use client';

import { useState, useTransition } from 'react';

import { Loader2, Music } from 'lucide-react';

import { generateMusicCueAction } from '@kit/audio-generation/server';
import { refusalMessage } from '@kit/next/action-result';
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
import { Label } from '@kit/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { toast } from '@kit/ui/sonner';
import { Switch } from '@kit/ui/switch';
import { Textarea } from '@kit/ui/textarea';

interface AddMusicCueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  episodeId: string;
  totalDuration: number;
  onSuccess: () => void;
}

const GENRES = [
  { value: 'cinematic', label: 'Cinematic' },
  { value: 'orchestral', label: 'Orchestral' },
  { value: 'electronic', label: 'Electronic' },
  { value: 'ambient', label: 'Ambient' },
  { value: 'jazz', label: 'Jazz' },
  { value: 'pop', label: 'Pop' },
  { value: 'rock', label: 'Rock' },
  { value: 'classical', label: 'Classical' },
];

const MOODS = [
  { value: 'dramatic', label: 'Dramatic' },
  { value: 'uplifting', label: 'Uplifting' },
  { value: 'melancholic', label: 'Melancholic' },
  { value: 'tense', label: 'Tense' },
  { value: 'peaceful', label: 'Peaceful' },
  { value: 'mysterious', label: 'Mysterious' },
  { value: 'energetic', label: 'Energetic' },
  { value: 'romantic', label: 'Romantic' },
];

const TEMPOS = [
  { value: 'slow', label: 'Slow' },
  { value: 'medium', label: 'Medium' },
  { value: 'fast', label: 'Fast' },
  { value: 'varied', label: 'Varied' },
];

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function AddMusicCueDialog({
  open,
  onOpenChange,
  episodeId,
  totalDuration,
  onSuccess,
}: AddMusicCueDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [prompt, setPrompt] = useState('');
  const [cueName, setCueName] = useState('');
  const [duration, setDuration] = useState('30');
  const [timelineStart, setTimelineStart] = useState('0');
  const [genre, setGenre] = useState<string>('');
  const [mood, setMood] = useState<string>('');
  const [tempo, setTempo] = useState<string>('');
  const [instrumentalOnly, setInstrumentalOnly] = useState(true);

  const handleSubmit = () => {
    if (!prompt.trim()) {
      toast.error('Please enter a music prompt');
      return;
    }

    const durationNum = parseInt(duration, 10);
    if (isNaN(durationNum) || durationNum < 15 || durationNum > 240) {
      toast.error('Duration must be between 15 and 240 seconds');
      return;
    }

    const startNum = parseFloat(timelineStart);
    if (isNaN(startNum) || startNum < 0) {
      toast.error('Timeline position must be 0 or greater');
      return;
    }

    startTransition(async () => {
      try {
        const result = await generateMusicCueAction({
          episodeId,
          prompt: prompt.trim(),
          duration: durationNum,
          timelineStartSeconds: startNum,
          name: cueName.trim() || undefined,
          genre: genre || undefined,
          mood: mood || undefined,
          tempo: (tempo as 'slow' | 'medium' | 'fast' | 'varied') || undefined,
          instrumentalOnly,
        });

        if (result.success) {
          toast.success('Music cue generation started');
          onOpenChange(false);
          onSuccess();
          // Reset form
          setPrompt('');
          setCueName('');
          setDuration('30');
          setTimelineStart('0');
          setGenre('');
          setMood('');
          setTempo('');
        }
      } catch (error) {
        toast.error(refusalMessage(error, 'Failed to start music generation'));
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Music className="h-5 w-5" />
            Add Music Cue
          </DialogTitle>
          <DialogDescription>
            Add a custom music cue at a specific point in the timeline. Describe
            the music you want and specify its position.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Cue name (optional) */}
          <div className="grid gap-2">
            <Label htmlFor="cueName">Cue Name (optional)</Label>
            <Input
              id="cueName"
              placeholder="e.g., Climax Music, Transition Theme"
              value={cueName}
              onChange={(e) => setCueName(e.target.value)}
              maxLength={100}
            />
          </div>

          {/* Music prompt (required) */}
          <div className="grid gap-2">
            <Label htmlFor="prompt">Music Description *</Label>
            <Textarea
              id="prompt"
              placeholder="Describe the music you want (e.g., 'Dramatic orchestral tension building with strings and brass, building to a crescendo')"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              maxLength={500}
            />
            <p className="text-xs text-gray-500">
              Be descriptive - mention instruments, mood, tempo, and style
            </p>
          </div>

          {/* Timeline position and duration */}
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="timelineStart">Start Position (seconds)</Label>
              <Input
                id="timelineStart"
                type="number"
                placeholder="0"
                value={timelineStart}
                onChange={(e) => setTimelineStart(e.target.value)}
                min={0}
                max={totalDuration}
              />
              <p className="text-xs text-gray-500">
                Max: {formatTime(totalDuration)} ({Math.round(totalDuration)}s)
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="duration">Duration (seconds) *</Label>
              <Input
                id="duration"
                type="number"
                placeholder="30"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                min={15}
                max={240}
              />
              <p className="text-xs text-gray-500">15-240 seconds</p>
            </div>
          </div>

          {/* Genre and Mood */}
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="genre">Genre</Label>
              <Select value={genre} onValueChange={setGenre}>
                <SelectTrigger id="genre">
                  <SelectValue placeholder="Auto-detect" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Auto-detect</SelectItem>
                  {GENRES.map((g) => (
                    <SelectItem key={g.value} value={g.value}>
                      {g.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="mood">Mood</Label>
              <Select value={mood} onValueChange={setMood}>
                <SelectTrigger id="mood">
                  <SelectValue placeholder="Auto-detect" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Auto-detect</SelectItem>
                  {MOODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Tempo */}
          <div className="grid gap-2">
            <Label htmlFor="tempo">Tempo</Label>
            <Select value={tempo} onValueChange={setTempo}>
              <SelectTrigger id="tempo">
                <SelectValue placeholder="Auto-detect" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Auto-detect</SelectItem>
                {TEMPOS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Instrumental only */}
          <div className="flex items-center justify-between">
            <Label htmlFor="instrumental" className="cursor-pointer">
              Instrumental Only
            </Label>
            <Switch
              id="instrumental"
              checked={instrumentalOnly}
              onCheckedChange={setInstrumentalOnly}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !prompt.trim()}>
            {isPending ? (
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
