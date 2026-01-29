'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@kit/ui/card';
import { Button } from '@kit/ui/button';
import { Badge } from '@kit/ui/badge';
import { Textarea } from '@kit/ui/textarea';
import { Loader2, Sparkles, AlertTriangle, Save } from 'lucide-react';
import { extractCanonChangesAction, commitCanonChangesAction } from '@kit/episodes/server';
import { toast } from '@kit/ui/sonner';

interface EpisodeSummaryGeneratorProps {
    projectId: string;
    episodeId: string;
    episodeNumber: number;
    season: number;
    storyContent: string;
    onSummaryGenerated?: (summary: string) => void;
}

interface ExtractedChange {
    id: string; // Unique identifier for stable React keys
    type: 'death' | 'world_fact' | 'relationship' | 'timeline' | 'ability_loss' | 'location_destruction';
    eventKey: string;
    description: string;
    confidence: 'high' | 'medium' | 'low';
}

/**
 * Episode Summary Generator - Review canon changes before publish
 * FILM-1007 Component (Step 6)
 */
export function EpisodeSummaryGenerator({
    projectId,
    episodeId,
    episodeNumber,
    season,
    storyContent,
    onSummaryGenerated,
}: EpisodeSummaryGeneratorProps) {
    const [isExtracting, setIsExtracting] = useState(false);
    const [isCommitting, setIsCommitting] = useState(false);
    const [summary, setSummary] = useState('');
    const [sentimentScore, setSentimentScore] = useState(0.5);
    const [extractedEvents, setExtractedEvents] = useState<ExtractedChange[]>([]);
    const [hasExtracted, setHasExtracted] = useState(false);

    // Use ref for callback to avoid re-renders if parent provides unstable function
    const onSummaryGeneratedRef = useRef(onSummaryGenerated);
    onSummaryGeneratedRef.current = onSummaryGenerated;

    const handleExtract = useCallback(async () => {
        if (!storyContent) {
            toast.error('No story content to analyze');
            return;
        }

        setIsExtracting(true);
        try {
            const result = await extractCanonChangesAction({
                projectId,
                episodeId,
                storyContent,
            });

            if (result) {
                setSummary(result.episodeSummary);
                setSentimentScore(result.sentimentScore);
                // Add unique IDs for stable React keys
                const eventsWithIds = result.immutableEvents.map((event) => ({
                    id: crypto.randomUUID(),
                    ...event,
                }));
                setExtractedEvents(eventsWithIds);
                setHasExtracted(true);
                onSummaryGeneratedRef.current?.(result.episodeSummary);
            }
        } catch (error) {
            console.error('Extraction error:', error);
            toast.error('Failed to extract canon changes');
        } finally {
            setIsExtracting(false);
        }
    }, [projectId, episodeId, storyContent]);

    // Extract canon changes on mount if story content exists
    useEffect(() => {
        if (storyContent && storyContent.length > 100 && !hasExtracted) {
            handleExtract();
        }
    }, [storyContent, hasExtracted, handleExtract]);

    async function handleCommit() {
        setIsCommitting(true);
        try {
            const result = await commitCanonChangesAction({
                projectId,
                episodeId,
                season,
                episodeNumber,
                changes: {
                    immutableEvents: extractedEvents,
                    threadUpdates: [],
                    episodeSummary: summary,
                    sentimentScore,
                },
            });

            if (result) {
                toast.success(
                    `Canon updated: ${result.eventsCreated} events, summary ${result.summaryStored ? 'saved' : 'skipped'}`
                );
            }
        } catch (error) {
            console.error('Commit error:', error);
            toast.error('Failed to commit canon changes');
        } finally {
            setIsCommitting(false);
        }
    }

    const getSentimentLabel = (score: number) => {
        if (score >= 0.7) return { label: 'Positive', color: 'bg-green-500' };
        if (score >= 0.4) return { label: 'Neutral', color: 'bg-yellow-500' };
        return { label: 'Dark', color: 'bg-red-500' };
    };

    const sentiment = getSentimentLabel(sentimentScore);

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            <Sparkles className="h-5 w-5" />
                            Episode Summary & Canon
                        </CardTitle>
                        <CardDescription>
                            Review detected canon changes before publishing
                        </CardDescription>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleExtract}
                        disabled={isExtracting || !storyContent}
                    >
                        {isExtracting ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                            <Sparkles className="h-4 w-4 mr-2" />
                        )}
                        {hasExtracted ? 'Re-analyze' : 'Analyze'}
                    </Button>
                </div>
            </CardHeader>

            <CardContent className="space-y-4">
                {/* Episode Summary */}
                <div>
                    <label className="text-sm font-medium mb-2 block">
                        Episode Summary
                    </label>
                    <Textarea
                        value={summary}
                        onChange={(e) => setSummary(e.target.value)}
                        placeholder="Episode summary will be generated from story content..."
                        rows={3}
                    />
                </div>

                {/* Sentiment Score */}
                <div className="flex items-center gap-4">
                    <span className="text-sm font-medium">Tone:</span>
                    <Badge className={sentiment.color}>{sentiment.label}</Badge>
                    <span className="text-xs text-muted-foreground">
                        ({Math.round(sentimentScore * 100)}% positive)
                    </span>
                </div>

                {/* Extracted Canon Events */}
                {extractedEvents.length > 0 && (
                    <div>
                        <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4 text-yellow-500" />
                            Detected Canon Changes ({extractedEvents.length})
                        </h4>
                        <ul className="space-y-2">
                            {extractedEvents.map((event) => (
                                <li
                                    key={event.id}
                                    className="flex items-center justify-between p-2 bg-muted rounded text-sm"
                                >
                                    <span>
                                        <Badge variant="outline" className="mr-2">
                                            {event.type}
                                        </Badge>
                                        {event.description}
                                    </span>
                                    <Badge
                                        variant={
                                            event.confidence === 'high'
                                                ? 'default'
                                                : event.confidence === 'medium'
                                                    ? 'secondary'
                                                    : 'outline'
                                        }
                                    >
                                        {event.confidence}
                                    </Badge>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* Commit Button */}
                {hasExtracted && (
                    <div className="flex justify-end pt-4 border-t">
                        <Button onClick={handleCommit} disabled={isCommitting}>
                            {isCommitting ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                                <Save className="h-4 w-4 mr-2" />
                            )}
                            Save to Canon
                        </Button>
                    </div>
                )}

                {!hasExtracted && !isExtracting && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                        Click &quot;Analyze&quot; to extract canon changes from the episode story.
                    </p>
                )}
            </CardContent>
        </Card>
    );
}
