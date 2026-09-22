'use client';

import { useState, useTransition } from 'react';

import { Loader2, Music } from 'lucide-react';

import { generateSceneMusicAction } from '@kit/audio-generation/server';
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
import { toast } from '@kit/ui/sonner';
import { Switch } from '@kit/ui/switch';
import { Textarea } from '@kit/ui/textarea';

interface GenerateSceneMusicDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  episodeId: string;
  scenes: Array<{
    number: number;
    heading: string;
    estimatedDuration: number;
  }>;
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

export function GenerateSceneMusicDialog({
  open,
  onOpenChange,
  episodeId,
  scenes,
  onSuccess,
}: GenerateSceneMusicDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [selectedScene, setSelectedScene] = useState<string>('');
  const [genre, setGenre] = useState<string>('');
  const [mood, setMood] = useState<string>('');
  const [tempo, setTempo] = useState<string>('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [customDuration, setCustomDuration] = useState('');
  const [instrumentalOnly, setInstrumentalOnly] = useState(true);

  const handleSubmit = () => {
    if (!selectedScene) {
      toast.error('Please select a scene');
      return;
    }

    startTransition(async () => {
      try {
        const result = await unwrap(
          generateSceneMusicAction({
            episodeId,
            sceneNumber: parseInt(selectedScene, 10),
            genre: genre || undefined,
            mood: mood || undefined,
            tempo:
              (tempo as 'slow' | 'medium' | 'fast' | 'varied') || undefined,
            prompt: customPrompt || undefined,
            duration: customDuration ? parseInt(customDuration, 10) : undefined,
            instrumentalOnly,
          }),
        );

        if (result.success) {
          toast.success('Music generation started');
          onOpenChange(false);
          onSuccess();
          // Reset form
          setSelectedScene('');
          setGenre('');
          setMood('');
          setTempo('');
          setCustomPrompt('');
          setCustomDuration('');
        }
      } catch (error) {
        toast.error(refusalMessage(error, 'Failed to start music generation'));
      }
    });
  };

  const selectedSceneData = scenes.find(
    (s) => s.number.toString() === selectedScene,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Music className="h-5 w-5" />
            Generate Scene Music
          </DialogTitle>
          <DialogDescription>
            Generate background music for a specific scene. The music will be
            automatically positioned on the timeline.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Scene selector */}
          <div className="grid gap-2">
            <Label htmlFor="scene">Scene *</Label>
            <Select value={selectedScene} onValueChange={setSelectedScene}>
              <SelectTrigger id="scene">
                <SelectValue placeholder="Select a scene" />
              </SelectTrigger>
              <SelectContent>
                {scenes.map((scene) => (
                  <SelectItem
                    key={scene.number}
                    value={scene.number.toString()}
                  >
                    Scene {scene.number}: {scene.heading}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedSceneData && (
              <p className="text-xs text-gray-500">
                Duration: ~{Math.round(selectedSceneData.estimatedDuration)}s
              </p>
            )}
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

          {/* Custom prompt */}
          <div className="grid gap-2">
            <Label htmlFor="prompt">Custom Prompt (optional)</Label>
            <Textarea
              id="prompt"
              placeholder="Override the auto-generated prompt with your own description..."
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              rows={2}
            />
          </div>

          {/* Custom duration */}
          <div className="grid gap-2">
            <Label htmlFor="duration">Duration Override (seconds)</Label>
            <Input
              id="duration"
              type="number"
              placeholder="Use scene duration"
              value={customDuration}
              onChange={(e) => setCustomDuration(e.target.value)}
              min={15}
              max={240}
            />
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
          <Button onClick={handleSubmit} disabled={isPending || !selectedScene}>
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
