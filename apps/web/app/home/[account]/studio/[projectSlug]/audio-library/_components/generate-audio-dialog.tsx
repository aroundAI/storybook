'use client';

/**
 * GenerateAudioDialog Component
 *
 * Dialog to generate new music or SFX using AI.
 */
import { useState } from 'react';
import { useTransition } from 'react';

import { Loader2, Music, Sparkles, Volume2 } from 'lucide-react';

import { refusalMessage, unwrap } from '@kit/next/action-result';
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
import { Tabs, TabsList, TabsTrigger } from '@kit/ui/tabs';
import { Textarea } from '@kit/ui/textarea';

interface GenerateAudioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onSuccess?: () => void;
}

const MUSIC_GENRES = [
  'cinematic',
  'electronic',
  'ambient',
  'orchestral',
  'rock',
  'pop',
  'jazz',
  'lofi',
  'dramatic',
  'uplifting',
] as const;

const MUSIC_MOODS = [
  'happy',
  'sad',
  'tense',
  'mysterious',
  'peaceful',
  'energetic',
  'romantic',
  'epic',
] as const;

export function GenerateAudioDialog({
  open,
  onOpenChange,
  projectId,
  onSuccess,
}: GenerateAudioDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [audioType, setAudioType] = useState<'music' | 'sfx'>('music');
  const [prompt, setPrompt] = useState('');
  const [name, setName] = useState('');
  const [duration, setDuration] = useState('30');
  const [genre, setGenre] = useState<string>('');
  const [mood, setMood] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError('Please enter a prompt');
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        // Import actions dynamically
        const { generateMusicAssetAction, generateSfxAssetAction } =
          await import('@kit/audio-generation/server');

        if (audioType === 'music') {
          await unwrap(
            generateMusicAssetAction({
              projectId,
              prompt: prompt.trim(),
              name: name.trim() || undefined,
              duration: Number(duration),
              genre: genre || undefined,
              mood: mood || undefined,
            }),
          );
        } else {
          await unwrap(
            generateSfxAssetAction({
              projectId,
              prompt: prompt.trim(),
              name: name.trim() || undefined,
              duration: Number(duration),
            }),
          );
        }

        onOpenChange(false);
        onSuccess?.();

        // Reset form
        setPrompt('');
        setName('');
        setDuration('30');
        setGenre('');
        setMood('');
      } catch (err) {
        setError(refusalMessage(err, 'Failed to generate audio'));
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Generate Audio
          </DialogTitle>
          <DialogDescription>
            Use AI to generate music or sound effects for your project
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Audio Type Tabs */}
          <Tabs
            value={audioType}
            onValueChange={(v) => setAudioType(v as 'music' | 'sfx')}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="music" className="gap-1.5">
                <Music className="h-4 w-4" />
                Music
              </TabsTrigger>
              <TabsTrigger value="sfx" className="gap-1.5">
                <Volume2 className="h-4 w-4" />
                Sound Effects
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name">Name (optional)</Label>
            <Input
              id="name"
              placeholder={
                audioType === 'music' ? 'Main Theme' : 'Footsteps on gravel'
              }
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Prompt */}
          <div className="space-y-2">
            <Label htmlFor="prompt">Prompt *</Label>
            <Textarea
              id="prompt"
              placeholder={
                audioType === 'music'
                  ? 'Epic orchestral music with building tension, dramatic brass'
                  : 'Heavy rain on a window, thunder in the distance'
              }
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              Describe the {audioType === 'music' ? 'music' : 'sound'} you want
              to generate
            </p>
          </div>

          {/* Music-specific options */}
          {audioType === 'music' && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Genre</Label>
                <Select value={genre} onValueChange={setGenre}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select genre" />
                  </SelectTrigger>
                  <SelectContent>
                    {MUSIC_GENRES.map((g) => (
                      <SelectItem key={g} value={g} className="capitalize">
                        {g}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Mood</Label>
                <Select value={mood} onValueChange={setMood}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select mood" />
                  </SelectTrigger>
                  <SelectContent>
                    {MUSIC_MOODS.map((m) => (
                      <SelectItem key={m} value={m} className="capitalize">
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Duration */}
          <div className="space-y-2">
            <Label htmlFor="duration">
              Duration (seconds)
              <span className="ml-1 text-muted-foreground">
                {audioType === 'music' ? '(max 300)' : '(max 22)'}
              </span>
            </Label>
            <Input
              id="duration"
              type="number"
              min={audioType === 'music' ? 5 : 1}
              max={audioType === 'music' ? 300 : 22}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="w-32"
            />
          </div>

          {/* Error */}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleGenerate} disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="mr-1.5 h-4 w-4" />
                Generate
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
