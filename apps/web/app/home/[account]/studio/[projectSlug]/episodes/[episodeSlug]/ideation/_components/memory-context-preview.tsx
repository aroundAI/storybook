'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Button } from '@kit/ui/button';
import { ChevronDown, ChevronRight, BookOpen, Users, GitBranch, Clock } from 'lucide-react';
import { buildMemoryContextAction } from '@kit/episodes/server';

interface MemoryContextPreviewProps {
    projectId: string;
    episodeNumber: number;
}

interface MemoryContext {
    immutableEvents: Array<{
        id: string;
        eventType: string;
        description: string;
        episodeNumber: number;
    }>;
    activeThreads: Array<{
        id: string;
        threadName: string;
        status: string;
    }>;
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
export function MemoryContextPreview({ projectId, episodeNumber }: MemoryContextPreviewProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [context, setContext] = useState<MemoryContext | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (isExpanded && !context) {
            loadContext();
        }
    }, [isExpanded]);

    async function loadContext() {
        setIsLoading(true);
        try {
            const result = await buildMemoryContextAction({
                projectId,
                episodeNumber,
            });

            if (result) {
                // Transform to simpler structure - using explicit types for server action response
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const events = result.immutableEvents as any[];
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const threads = result.activeThreads as any[];
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const characters = result.characterStates as any[];

                setContext({
                    immutableEvents: events.map((e) => ({
                        id: e.id,
                        eventType: e.eventType,
                        description: e.description,
                        episodeNumber: e.episodeNumber,
                    })),
                    activeThreads: threads.map((t) => ({
                        id: t.id,
                        threadName: t.threadName,
                        status: t.status,
                    })),
                    characterStates: characters.map((c) => ({
                        characterId: c.characterId,
                        characterName: c.characterName ?? 'Unknown',
                        currentState: c.currentStates?.[0]?.stateType ?? 'unknown',
                    })),
                    tokenBudget: {
                        used: (result.tokenBudget as { used?: number })?.used ?? 0,
                        max: (result.tokenBudget as { max?: number })?.max ?? 6000,
                        percentage: (result.tokenBudget as { percentage?: number })?.percentage ?? 0,
                    },
                });
            }
        } catch (error) {
            console.error('Error loading memory context:', error);
        } finally {
            setIsLoading(false);
        }
    }

    const tokenPercentage = context?.tokenBudget.percentage ?? 0;

    return (
        <Card className="border-dashed">
            <CardHeader className="py-3 cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
                <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
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
                <CardContent className="pt-0 space-y-4">
                    {isLoading ? (
                        <p className="text-sm text-muted-foreground">Loading context...</p>
                    ) : context ? (
                        <>
                            {/* Immutable Facts */}
                            <div>
                                <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    Immutable Facts ({context.immutableEvents.length})
                                </h4>
                                <ul className="text-sm space-y-1">
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
                                <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-1">
                                    <GitBranch className="h-3 w-3" />
                                    Active Threads ({context.activeThreads.length})
                                </h4>
                                <ul className="text-sm space-y-1">
                                    {context.activeThreads.slice(0, 5).map((t) => (
                                        <li key={t.id} className="text-muted-foreground">
                                            • {t.threadName} ({t.status})
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            {/* Character States */}
                            <div>
                                <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-1">
                                    <Users className="h-3 w-3" />
                                    Character States ({context.characterStates.length})
                                </h4>
                                <ul className="text-sm space-y-1">
                                    {context.characterStates.slice(0, 5).map((c) => (
                                        <li key={c.characterId} className="text-muted-foreground">
                                            • {c.characterName}: {c.currentState}
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            {/* Token Budget */}
                            <div>
                                <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                                    Token Budget: {context.tokenBudget.used.toLocaleString()} /{' '}
                                    {context.tokenBudget.max.toLocaleString()} ({tokenPercentage}%)
                                </h4>
                                <div className="w-full bg-muted rounded-full h-2">
                                    <div
                                        className={`h-2 rounded-full ${tokenPercentage > 80
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
                        <p className="text-sm text-muted-foreground">
                            Unable to load memory context.
                        </p>
                    )}
                </CardContent>
            )}
        </Card>
    );
}
