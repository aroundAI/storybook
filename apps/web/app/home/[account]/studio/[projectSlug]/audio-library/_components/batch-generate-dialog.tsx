'use client';

/**
 * BatchGenerateDialog Component
 * 
 * Dialog for batch generating multiple music or SFX assets at once.
 */

import { useState, useMemo } from 'react';
import { useTransition } from 'react';
import { Sparkles, Music, Volume2, Loader2, Plus, X, AlertCircle } from 'lucide-react';

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
import { Textarea } from '@kit/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@kit/ui/tabs';
import { Badge } from '@kit/ui/badge';
import { Progress } from '@kit/ui/progress';
import { ScrollArea } from '@kit/ui/scroll-area';
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
            (item) => item.status === 'completed' || item.status === 'failed'
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
            const { generateMusicAction, generateSfxAction } = await import(
                '@kit/audio-generation/server'
            );

            // Process items sequentially with delay for rate limiting
            for (let i = 0; i < items.length; i++) {
                setCurrentIndex(i);
                setItems((prev) =>
                    prev.map((item, idx) =>
                        idx === i ? { ...item, status: 'generating' } : item
                    )
                );

                try {
                    if (audioType === 'music') {
                        await generateMusicAction({
                            projectId,
                            prompt: items[i].prompt,
                            duration: items[i].duration,
                        });
                    } else {
                        await generateSfxAction({
                            projectId,
                            prompt: items[i].prompt,
                            duration: items[i].duration,
                        });
                    }

                    setItems((prev) =>
                        prev.map((item, idx) =>
                            idx === i ? { ...item, status: 'completed' } : item
                        )
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
                                : item
                        )
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
            <DialogContent className="sm:max-w-xl max-h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-primary" />
                        Batch Generate
                    </DialogTitle>
                    <DialogDescription>
                        Generate multiple audio assets at once
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 flex-1 min-h-0 overflow-hidden py-4">
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
                                    <Plus className="h-4 w-4 mr-1.5" />
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
                                        <span className="font-medium">
                                            {Math.round(progress)}%
                                        </span>
                                    </div>
                                    <Progress value={progress} />
                                </div>
                            )}

                            {/* Items List */}
                            <ScrollArea className="flex-1 -mx-6 px-6 max-h-64">
                                <div className="space-y-2">
                                    {items.map((item, index) => (
                                        <div
                                            key={item.id}
                                            className={cn(
                                                'flex items-center gap-3 p-3 rounded-lg border',
                                                item.status === 'generating' && 'border-primary bg-primary/5',
                                                item.status === 'completed' && 'border-green-500 bg-green-50 dark:bg-green-950/20',
                                                item.status === 'failed' && 'border-red-500 bg-red-50 dark:bg-red-950/20',
                                                item.status === 'pending' && 'border-muted',
                                            )}
                                        >
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium truncate">
                                                    {item.prompt}
                                                </p>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <Badge
                                                        variant={
                                                            item.status === 'completed' ? 'default' :
                                                                item.status === 'failed' ? 'destructive' :
                                                                    item.status === 'generating' ? 'secondary' :
                                                                        'outline'
                                                        }
                                                        className="text-xs"
                                                    >
                                                        {item.status === 'generating' && (
                                                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                                        )}
                                                        {item.status}
                                                    </Badge>
                                                    <span className="text-xs text-muted-foreground">
                                                        {item.duration}s
                                                    </span>
                                                </div>
                                                {item.error && (
                                                    <p className="text-xs text-destructive mt-1">
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
                            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-200">
                                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                                <p className="text-xs">
                                    Items are generated sequentially with a 2-second delay between each to respect API rate limits.
                                </p>
                            </div>
                        </>
                    )}

                    {/* Error */}
                    {error && (
                        <p className="text-sm text-destructive">{error}</p>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    {hasItems ? (
                        <Button onClick={handleGenerate} disabled={isGenerating}>
                            {isGenerating ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                                    Generating...
                                </>
                            ) : (
                                <>
                                    <Sparkles className="h-4 w-4 mr-1.5" />
                                    Generate {items.length} Items
                                </>
                            )}
                        </Button>
                    ) : (
                        <Button onClick={parseBulkInput} disabled={!bulkInput.trim()}>
                            <Plus className="h-4 w-4 mr-1.5" />
                            Add Items
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
