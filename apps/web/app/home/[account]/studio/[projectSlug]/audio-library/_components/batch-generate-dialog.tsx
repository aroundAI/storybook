'use client';

/**
 * BatchGenerateDialog Component
 *
 * Dialog for batch generating multiple music or SFX assets at once.
 */
import { useMemo, useState } from 'react';
import { useTransition } from 'react';

import {
  AlertCircle,
  Loader2,
  Music,
  Plus,
  Sparkles,
  Volume2,
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
import { Label } from '@kit/ui/label';
import { Progress } from '@kit/ui/progress';
import { ScrollArea } from '@kit/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@kit/ui/tabs';
import { Textarea } from '@kit/ui/textarea';
import { cn } from '@kit/ui/utils';

interface BatchItem {
  id: string;
  prompt: string;
  name?: string;
  duration: number;
  status: 'pending' | 'generating' | 'completed' | 'failed';
  error?: string;
}

interface BatchGenerateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onSuccess?: () => void;
}

export function BatchGenerateDialog({
  open,
  onOpenChange,
  projectId,
  onSuccess,
}: BatchGenerateDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [audioType, setAudioType] = useState<'music' | 'sfx'>('music');
  const [bulkInput, setBulkInput] = useState('');
  const [items, setItems] = useState<BatchItem[]>([]);
  const [defaultDuration, setDefaultDuration] = useState(30);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);

  // Parse bulk input into items
  const parseBulkInput = () => {
    const lines = bulkInput
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length === 0) {
      setError('Please enter at least one prompt');
      return;
    }

    const newItems: BatchItem[] = lines.map((line, index) => ({
      id: `batch-${Date.now()}-${index}`,
      prompt: line,
      duration: defaultDuration,
      status: 'pending',
    }));

    setItems(newItems);
    setBulkInput('');
    setError(null);
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const progress = useMemo(() => {
    if (items.length === 0) return 0;
    const completed = items.filter(
      (item) => item.status === 'completed' || item.status === 'failed',
    ).length;
    return (completed / items.length) * 100;
  }, [items]);

  const handleGenerate = async () => {
    if (items.length === 0) {
      setError('No items to generate');
      return;
    }

    setError(null);
    startTransition(async () => {
      // Import actions dynamically
      const { generateMusicAssetAction, generateSfxAssetAction } = await import(
        '@kit/audio-generation/server'
      );

      // Process items sequentially with delay for rate limiting
      for (let i = 0; i < items.length; i++) {
        setCurrentIndex(i);
        setItems((prev) =>
          prev.map((item, idx) =>
            idx === i ? { ...item, status: 'generating' } : item,
          ),
        );

        try {
          if (audioType === 'music') {
            await generateMusicAssetAction({
              projectId,
              prompt: items[i]!.prompt,
              duration: items[i]!.duration,
            });
          } else {
            await generateSfxAssetAction({
              projectId,
              prompt: items[i]!.prompt,
              duration: items[i]!.duration,
            });
          }

          setItems((prev) =>
            prev.map((item, idx) =>
              idx === i ? { ...item, status: 'completed' } : item,
            ),
          );
        } catch (err) {
          setItems((prev) =>
            prev.map((item, idx) =>
              idx === i
                ? {
                    ...item,
                    status: 'failed',
                    error: err instanceof Error ? err.message : 'Failed',
                  }
                : item,
            ),
          );
        }

        // Rate limit delay (2 seconds between requests)
        if (i < items.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      setCurrentIndex(-1);
      onSuccess?.();
    });
  };

  const isGenerating = isPending;
  const hasItems = items.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="text-primary h-5 w-5" />
            Batch Generate
          </DialogTitle>
          <DialogDescription>
            Generate multiple audio assets at once
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-hidden py-4">
          {/* Audio Type */}
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
                SFX
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Bulk Input or Items List */}
          {!hasItems ? (
            <>
              <div className="space-y-2">
                <Label>Prompts (one per line)</Label>
                <Textarea
                  placeholder={
                    audioType === 'music'
                      ? 'Epic orchestral battle music\nSoft piano melody for sad scene\nUpbeat electronic intro'
                      : 'Thunder rumbling in distance\nGlass shattering\nFootsteps on gravel'
                  }
                  value={bulkInput}
                  onChange={(e) => setBulkInput(e.target.value)}
                  rows={6}
                  className="font-mono text-sm"
                />
              </div>

              <div className="flex items-center gap-4">
                <div className="space-y-2">
                  <Label>Default Duration (sec)</Label>
                  <Input
                    type="number"
                    min={audioType === 'music' ? 5 : 1}
                    max={audioType === 'music' ? 300 : 22}
                    value={defaultDuration}
                    onChange={(e) => setDefaultDuration(Number(e.target.value))}
                    className="w-24"
                  />
                </div>
                <Button
                  onClick={parseBulkInput}
                  className="mt-6"
                  disabled={!bulkInput.trim()}
                >
                  <Plus className="mr-1.5 h-4 w-4" />
                  Add Items
                </Button>
              </div>
            </>
          ) : (
            <>
              {/* Progress */}
              {isGenerating && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      Generating {currentIndex + 1} of {items.length}...
                    </span>
                    <span className="font-medium">{Math.round(progress)}%</span>
                  </div>
                  <Progress value={progress} />
                </div>
              )}

              {/* Items List */}
              <ScrollArea className="-mx-6 max-h-64 flex-1 px-6">
                <div className="space-y-2">
                  {items.map((item, _index) => (
                    <div
                      key={item.id}
                      className={cn(
                        'flex items-center gap-3 rounded-lg border p-3',
                        item.status === 'generating' &&
                          'border-primary bg-primary/5',
                        item.status === 'completed' &&
                          'border-green-500 bg-green-50 dark:bg-green-950/20',
                        item.status === 'failed' &&
                          'border-red-500 bg-red-50 dark:bg-red-950/20',
                        item.status === 'pending' && 'border-muted',
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {item.prompt}
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                          <Badge
                            variant={
                              item.status === 'completed'
                                ? 'default'
                                : item.status === 'failed'
                                  ? 'destructive'
                                  : item.status === 'generating'
                                    ? 'secondary'
                                    : 'outline'
                            }
                            className="text-xs"
                          >
                            {item.status === 'generating' && (
                              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            )}
                            {item.status}
                          </Badge>
                          <span className="text-muted-foreground text-xs">
                            {item.duration}s
                          </span>
                        </div>
                        {item.error && (
                          <p className="text-destructive mt-1 text-xs">
                            {item.error}
                          </p>
                        )}
                      </div>
                      {!isGenerating && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() => removeItem(item.id)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>

              {/* Rate Limit Warning */}
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="text-xs">
                  Items are generated sequentially with a 2-second delay between
                  each to respect API rate limits.
                </p>
              </div>
            </>
          )}

          {/* Error */}
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {hasItems ? (
            <Button onClick={handleGenerate} disabled={isGenerating}>
              {isGenerating ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="mr-1.5 h-4 w-4" />
                  Generate {items.length} Items
                </>
              )}
            </Button>
          ) : (
            <Button onClick={parseBulkInput} disabled={!bulkInput.trim()}>
              <Plus className="mr-1.5 h-4 w-4" />
              Add Items
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
