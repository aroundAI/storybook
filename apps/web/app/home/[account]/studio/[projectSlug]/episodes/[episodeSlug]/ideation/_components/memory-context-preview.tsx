'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Clock,
  GitBranch,
  Users,
} from 'lucide-react';

import {
  type MemoryContext as CanonMemoryContext,
  DEFAULT_TOKEN_BUDGET_MAX,
  type ImmutableEvent,
  type NarrativeThread,
} from '@kit/episodes';
import { buildMemoryContextAction } from '@kit/episodes/server';
import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';

interface MemoryContextPreviewProps {
  projectId: string;
  episodeNumber: number;
}

/**
 * Simplified types for UI display, derived from @kit/episodes types.
 * These contain only the fields needed for rendering.
 */
interface UIMemoryContext {
  immutableEvents: Pick<
    ImmutableEvent,
    'id' | 'eventType' | 'description' | 'episodeNumber'
  >[];
  activeThreads: Pick<NarrativeThread, 'id' | 'threadName' | 'status'>[];
  characterStates: Array<{
    characterId: string;
    characterName: string;
    currentState: string;
  }>;
  tokenBudget: {
    used: number;
    max: number;
    percentage: number;
  };
}

/**
 * Memory Context Preview - Shows what the AI knows
 * FILM-1007 Component 6
 */
export function MemoryContextPreview({
  projectId,
  episodeNumber,
}: MemoryContextPreviewProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [context, setContext] = useState<UIMemoryContext | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);

  const loadContext = useCallback(async () => {
    setIsLoading(true);
    setHasFailed(false);
    try {
      const result = await buildMemoryContextAction({
        projectId,
        episodeNumber,
      });

      if (result) {
        // Result is CanonMemoryContext from @kit/episodes
        const canonResult = result as CanonMemoryContext;

        // Use shared constant from @kit/episodes/lib/canon/memory-context-builder
        const used = canonResult.tokenBudget?.allocated ?? 0;
        const max = canonResult.tokenBudget?.total ?? DEFAULT_TOKEN_BUDGET_MAX;
        const percentage = max > 0 ? (used / max) * 100 : 0;

        setContext({
          immutableEvents: canonResult.immutableEvents.map((e) => ({
            id: e.id,
            eventType: e.eventType,
            description: e.description,
            episodeNumber: e.episodeNumber,
          })),
          activeThreads: canonResult.activeThreads.map((t) => ({
            id: t.id,
            threadName: t.threadName,
            status: t.status,
          })),
          characterStates: canonResult.characterStates.map((c) => ({
            characterId: c.characterId,
            characterName: c.characterName,
            currentState: c.currentStates?.[0]?.stateType ?? 'unknown',
          })),
          tokenBudget: { used, max, percentage },
        });
      }
    } catch (error) {
      console.error('Error loading memory context:', error);
      setHasFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [projectId, episodeNumber]);

  useEffect(() => {
    if (isExpanded && !context && !hasFailed) {
      loadContext();
    }
  }, [isExpanded, context, hasFailed, loadContext]);

  const tokenPercentage = Math.round(context?.tokenBudget.percentage ?? 0);
  const isEmpty =
    context !== null &&
    context.immutableEvents.length === 0 &&
    context.activeThreads.length === 0 &&
    context.characterStates.length === 0;

  return (
    <Card className="border-dashed" data-test="memory-context-preview">
      <CardHeader
        className="cursor-pointer py-3"
        data-test="memory-context-toggle"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <BookOpen className="h-4 w-4" />
            Memory Context Preview
          </CardTitle>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        </div>
        {!isExpanded && (
          <p className="text-xs text-muted-foreground">
            Click to see what the AI knows about canon
          </p>
        )}
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-4 pt-0">
          {isLoading ? (
            <p
              className="text-sm text-muted-foreground"
              data-test="memory-context-loading"
            >
              Loading context...
            </p>
          ) : isEmpty ? (
            <p
              className="text-sm text-muted-foreground"
              data-test="memory-context-empty"
            >
              Nothing in canon yet. Earlier episodes&apos; events, threads and
              character changes appear here once they are committed.
            </p>
          ) : context ? (
            <>
              {/* Immutable Facts */}
              <div>
                <h4 className="mb-2 flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase">
                  <Clock className="h-3 w-3" />
                  Immutable Facts ({context.immutableEvents.length})
                </h4>
                <ul className="space-y-1 text-sm">
                  {context.immutableEvents.slice(0, 5).map((e) => (
                    <li key={e.id} className="text-muted-foreground">
                      • {e.description} (Ep {e.episodeNumber})
                    </li>
                  ))}
                  {context.immutableEvents.length > 5 && (
                    <li className="text-xs italic">
                      +{context.immutableEvents.length - 5} more...
                    </li>
                  )}
                </ul>
              </div>

              {/* Active Threads */}
              <div>
                <h4 className="mb-2 flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase">
                  <GitBranch className="h-3 w-3" />
                  Active Threads ({context.activeThreads.length})
                </h4>
                <ul className="space-y-1 text-sm">
                  {context.activeThreads.slice(0, 5).map((t) => (
                    <li key={t.id} className="text-muted-foreground">
                      • {t.threadName} ({t.status})
                    </li>
                  ))}
                </ul>
              </div>

              {/* Character States */}
              <div>
                <h4 className="mb-2 flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase">
                  <Users className="h-3 w-3" />
                  Character States ({context.characterStates.length})
                </h4>
                <ul className="space-y-1 text-sm">
                  {context.characterStates.slice(0, 5).map((c) => (
                    <li key={c.characterId} className="text-muted-foreground">
                      • {c.characterName}: {c.currentState}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Token Budget */}
              <div>
                <h4 className="mb-2 text-xs font-semibold text-muted-foreground uppercase">
                  Token Budget: {context.tokenBudget.used.toLocaleString()} /{' '}
                  {context.tokenBudget.max.toLocaleString()} ({tokenPercentage}
                  %)
                </h4>
                <div className="h-2 w-full rounded-full bg-muted">
                  <div
                    className={`h-2 rounded-full ${
                      tokenPercentage > 80
                        ? 'bg-red-500'
                        : tokenPercentage > 50
                          ? 'bg-yellow-500'
                          : 'bg-green-500'
                    }`}
                    style={{ width: `${Math.min(tokenPercentage, 100)}%` }}
                  />
                </div>
              </div>
            </>
          ) : (
            <p
              className="text-sm text-muted-foreground"
              data-test="memory-context-error"
            >
              Unable to load memory context. Ideation still works without it.
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
