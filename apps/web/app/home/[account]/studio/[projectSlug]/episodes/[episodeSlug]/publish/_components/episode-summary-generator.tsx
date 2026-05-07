'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { AlertTriangle, Loader2, Save, Sparkles } from 'lucide-react';

import {
  commitCanonChangesAction,
  extractCanonChangesAction,
} from '@kit/episodes/server';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { toast } from '@kit/ui/sonner';
import { Textarea } from '@kit/ui/textarea';

interface EpisodeSummaryGeneratorProps {
  projectId: string;
  episodeId: string;
  episodeNumber: number;
  season?: number; // Optional to handle episodes without season
  storyContent: string;
  onSummaryGenerated?: (summary: string) => void;
}

interface ExtractedChange {
  id: string; // Unique identifier for stable React keys
  type:
    | 'death'
    | 'world_fact'
    | 'relationship'
    | 'timeline'
    | 'ability_loss'
    | 'location_destruction';
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
        // Add unique IDs for stable React keys (eventKey should be unique per event)
        const eventsWithIds = result.immutableEvents.map((event) => ({
          id: event.eventKey,
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
        season: season ?? 1, // Default to 1 only when committing if not provided
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
          `Canon updated: ${result.eventsCreated} events, summary ${result.summaryStored ? 'saved' : 'skipped'}`,
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
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            {hasExtracted ? 'Re-analyze' : 'Analyze'}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Episode Summary */}
        <div>
          <label className="mb-2 block text-sm font-medium">
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
          <span className="text-muted-foreground text-xs">
            ({Math.round(sentimentScore * 100)}% positive)
          </span>
        </div>

        {/* Extracted Canon Events */}
        {extractedEvents.length > 0 && (
          <div>
            <h4 className="mb-2 flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              Detected Canon Changes ({extractedEvents.length})
            </h4>
            <ul className="space-y-2">
              {extractedEvents.map((event) => (
                <li
                  key={event.id}
                  className="bg-muted flex items-center justify-between rounded p-2 text-sm"
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
          <div className="flex justify-end border-t pt-4">
            <Button onClick={handleCommit} disabled={isCommitting}>
              {isCommitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save to Canon
            </Button>
          </div>
        )}

        {!hasExtracted && !isExtracting && (
          <p className="text-muted-foreground py-4 text-center text-sm">
            Click &quot;Analyze&quot; to extract canon changes from the episode
            story.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
