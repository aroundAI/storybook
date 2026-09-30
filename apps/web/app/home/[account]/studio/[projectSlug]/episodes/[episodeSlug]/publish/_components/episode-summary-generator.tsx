'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  AlertTriangle,
  BookOpen,
  GitBranch,
  Loader2,
  Save,
  Sparkles,
  X,
} from 'lucide-react';

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

interface ExtractedThreadUpdate {
  threadName: string;
  threadType?:
    | 'plot'
    | 'character'
    | 'mystery'
    | 'romantic'
    | 'conflict'
    | 'thematic';
  action: 'open' | 'progress' | 'resolve';
  description: string;
  promises?: string[];
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
  const [extractedThreads, setExtractedThreads] = useState<
    ExtractedThreadUpdate[]
  >([]);
  const [hasExtracted, setHasExtracted] = useState(false);
  const [memory, setMemory] = useState<
    Pick<
      Awaited<ReturnType<typeof extractCanonChangesAction>>,
      'keyEvents' | 'characterChanges' | 'worldState'
    >
  >({ keyEvents: [], characterChanges: [] });

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
        setMemory({
          keyEvents: result.keyEvents,
          characterChanges: result.characterChanges,
          worldState: result.worldState,
        });
        // Add unique IDs for stable React keys (eventKey should be unique per event)
        const eventsWithIds = result.immutableEvents.map((event) => ({
          id: event.eventKey,
          ...event,
        }));
        setExtractedEvents(eventsWithIds);
        if (result.threadUpdates?.length) {
          setExtractedThreads(result.threadUpdates);
        }
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
          threadUpdates: extractedThreads,
          episodeSummary: summary,
          sentimentScore,
          ...memory,
        },
      });

      if (result) {
        toast.success(
          `Canon updated: ${result.eventsCreated} events, ${result.threadsUpdated ?? 0} threads, summary ${result.summaryStored ? 'saved' : 'skipped'}`,
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
          <span className="text-xs text-muted-foreground">
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
                  className="flex items-center justify-between rounded bg-muted p-2 text-sm"
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

        {/* Extracted Thread Updates */}
        {extractedThreads.length > 0 && (
          <div>
            <h4 className="mb-2 flex items-center gap-2 text-sm font-medium">
              <GitBranch className="h-4 w-4 text-purple-500" />
              Narrative Thread Updates ({extractedThreads.length})
            </h4>
            <ul className="space-y-2">
              {extractedThreads.map((thread, idx) => (
                <li
                  key={`${thread.threadName}-${idx}`}
                  className="group relative rounded bg-muted p-3 text-sm"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <BookOpen className="h-3.5 w-3.5 text-purple-500" />
                        <span className="font-medium">{thread.threadName}</span>
                        <Badge
                          variant={
                            thread.action === 'open'
                              ? 'default'
                              : thread.action === 'resolve'
                                ? 'secondary'
                                : 'outline'
                          }
                          className="text-[10px]"
                        >
                          {thread.action}
                        </Badge>
                        {thread.threadType && (
                          <Badge variant="outline" className="text-[10px]">
                            {thread.threadType}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {thread.description}
                      </p>
                      {thread.promises && thread.promises.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {thread.promises.map((promise, pIdx) => (
                            <Badge
                              key={pIdx}
                              variant="outline"
                              className="text-[10px] font-normal"
                            >
                              {promise}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setExtractedThreads((prev) =>
                          prev.filter((_, i) => i !== idx),
                        )
                      }
                      className="ml-2 flex-shrink-0 rounded-md p-1 text-gray-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                      title="Remove this thread update"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
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
          <p className="py-4 text-center text-sm text-muted-foreground">
            Click &quot;Analyze&quot; to extract canon changes from the episode
            story.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
