'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';

import {
    AlertTriangle,
    BookOpen,
    Calendar,
    ChevronDown,
    ChevronRight,
    GitBranch,
    Loader2,
    RefreshCw,
    Shield,
    Skull,
    User,
} from 'lucide-react';

import type {
    ImmutableEvent,
    NarrativeThread,
} from '@kit/episodes';
import { getActiveThreadsAction, getImmutableEventsAction, getProjectCharacterStatesAction } from '@kit/episodes/server';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@kit/ui/card';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from '@kit/ui/collapsible';
import { ScrollArea } from '@kit/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kit/ui/tabs';

import { AddEventDialog } from './add-event-dialog';
import { AddThreadDialog } from './add-thread-dialog';
import { EpisodeFactsPanel } from './episode-facts-panel';

interface CanonDashboardProps {
    projectId: string;
    episodeId: string;
    episodeNumber: number;
    season?: number;
    canonEnabled: boolean;
}

interface CharacterStateRow {
    id: string;
    character_id: string;
    state_type: string;
    state_value: unknown;
    trigger_event: string | null;
    characters?: { name: string } | null;
}

export function CanonDashboard({
    projectId,
    episodeId,
    episodeNumber,
    season = 1,
    canonEnabled,
}: CanonDashboardProps) {
    const [isPending, startTransition] = useTransition();
    const [events, setEvents] = useState<ImmutableEvent[]>([]);
    const [threads, setThreads] = useState<NarrativeThread[]>([]);
    const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());

    const [characterStates, setCharacterStates] = useState<CharacterStateRow[]>([]);

    const loadData = useCallback(() => {
        if (!canonEnabled) return;

        startTransition(async () => {
            const [eventsResult, threadsResult, statesResult] = await Promise.all([
                getImmutableEventsAction({ projectId }),
                getActiveThreadsAction({ projectId }),
                getProjectCharacterStatesAction({ projectId, limit: 20 }),
            ]);

            // Actions return arrays directly
            if (Array.isArray(eventsResult)) {
                setEvents(eventsResult);
            }
            if (Array.isArray(threadsResult)) {
                setThreads(threadsResult);
            }
            if (Array.isArray(statesResult)) {
                setCharacterStates(statesResult);
            }
        });
    }, [projectId, canonEnabled]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const toggleEvent = (eventId: string) => {
        setExpandedEvents((prev) => {
            const next = new Set(prev);
            if (next.has(eventId)) {
                next.delete(eventId);
            } else {
                next.add(eventId);
            }
            return next;
        });
    };

    if (!canonEnabled) {
        return (
            <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-8 text-center">
                    <Shield className="mb-3 h-10 w-10 text-muted-foreground" />
                    <h3 className="font-medium">Canon Management Disabled</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Enable Canon Management in Project Settings to track story
                        continuity
                    </p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <BookOpen className="h-5 w-5 text-violet-500" />
                        <CardTitle className="text-base">Canon Timeline</CardTitle>
                        <Badge variant="outline" className="text-xs">
                            Episode {episodeNumber}
                        </Badge>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={loadData}
                        disabled={isPending}
                    >
                        {isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <RefreshCw className="h-4 w-4" />
                        )}
                    </Button>
                </div>
                <CardDescription>
                    Immutable events, character states, and narrative threads
                </CardDescription>
            </CardHeader>
            <CardContent>
                <Tabs defaultValue="events" className="w-full">
                    <TabsList className="grid w-full grid-cols-4">
                        <TabsTrigger value="events" className="text-xs">
                            Events ({events.length})
                        </TabsTrigger>
                        <TabsTrigger value="threads" className="text-xs">
                            Threads ({threads.length})
                        </TabsTrigger>
                        <TabsTrigger value="characters" className="text-xs">
                            Characters
                        </TabsTrigger>
                        <TabsTrigger value="facts" className="text-xs">
                            Facts
                        </TabsTrigger>
                    </TabsList>

                    {/* Events Tab */}
                    <TabsContent value="events" className="mt-3">
                        <ScrollArea className="h-[300px]">
                            {events.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-8 text-center">
                                    <Calendar className="mb-2 h-8 w-8 text-muted-foreground" />
                                    <p className="text-sm text-muted-foreground">
                                        No immutable events recorded yet
                                    </p>
                                    <AddEventDialog
                                        projectId={projectId}
                                        episodeId={episodeId}
                                        season={season}
                                        episodeNumber={episodeNumber}
                                        onEventAdded={loadData}
                                    />
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {events.map((event) => (
                                        <Collapsible
                                            key={event.id}
                                            open={expandedEvents.has(event.id)}
                                            onOpenChange={() => toggleEvent(event.id)}
                                        >
                                            <CollapsibleTrigger asChild>
                                                <div className="flex cursor-pointer items-center gap-2 rounded-lg border p-2 hover:bg-muted/50">
                                                    {expandedEvents.has(event.id) ? (
                                                        <ChevronDown className="h-4 w-4" />
                                                    ) : (
                                                        <ChevronRight className="h-4 w-4" />
                                                    )}
                                                    <EventIcon eventType={event.eventType} />
                                                    <span className="flex-1 text-sm font-medium">
                                                        {event.eventKey}
                                                    </span>
                                                    <Badge variant="secondary" className="text-xs">
                                                        Ep. {event.episodeNumber}
                                                    </Badge>
                                                </div>
                                            </CollapsibleTrigger>
                                            <CollapsibleContent className="ml-6 mt-1 rounded-md bg-muted/30 p-3">
                                                <p className="text-sm">{event.description}</p>
                                                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                                                    <Calendar className="h-3 w-3" />
                                                    {new Date(event.createdAt).toLocaleDateString()}
                                                </div>
                                            </CollapsibleContent>
                                        </Collapsible>
                                    ))}
                                </div>
                            )}
                        </ScrollArea>
                    </TabsContent>

                    {/* Threads Tab */}
                    <TabsContent value="threads" className="mt-3">
                        <ScrollArea className="h-[300px]">
                            {threads.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-8 text-center">
                                    <GitBranch className="mb-2 h-8 w-8 text-muted-foreground" />
                                    <p className="text-sm text-muted-foreground">
                                        No narrative threads yet
                                    </p>
                                    <AddThreadDialog
                                        projectId={projectId}
                                        episodeId={episodeId}
                                        onThreadAdded={loadData}
                                    />
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {threads.map((thread) => (
                                        <div
                                            key={thread.id}
                                            className="flex items-center gap-3 rounded-lg border p-3"
                                        >
                                            <GitBranch className="h-4 w-4 text-blue-500" />
                                            <div className="flex-1">
                                                <p className="text-sm font-medium">
                                                    {thread.threadName}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {thread.description}
                                                </p>
                                            </div>
                                            <Badge
                                                variant={
                                                    thread.status === 'open'
                                                        ? 'default'
                                                        : thread.status === 'resolved'
                                                            ? 'secondary'
                                                            : 'outline'
                                                }
                                            >
                                                {thread.status}
                                            </Badge>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </ScrollArea>
                    </TabsContent>

                    {/* Characters Tab */}
                    <TabsContent value="characters" className="mt-3">
                        <ScrollArea className="h-[300px]">
                            {characterStates.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-8 text-center">
                                    <User className="mb-2 h-8 w-8 text-muted-foreground" />
                                    <p className="text-sm text-muted-foreground">
                                        No character states tracked yet
                                    </p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        States are recorded during story generation
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {characterStates.map((state) => (
                                        <div
                                            key={state.id}
                                            className="flex items-start gap-3 rounded-lg border p-3"
                                        >
                                            <User className="h-4 w-4 text-green-500 mt-0.5" />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium truncate">
                                                    {state.characters?.name ?? state.character_id}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    Type: {state.state_type}
                                                </p>
                                                {state.trigger_event && (
                                                    <p className="text-xs text-muted-foreground">
                                                        Trigger: {state.trigger_event}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </ScrollArea>
                    </TabsContent>

                    {/* Facts Tab */}
                    <TabsContent value="facts" className="mt-3">
                        <EpisodeFactsPanel
                            episodeId={episodeId}
                            projectId={projectId}
                        />
                    </TabsContent>
                </Tabs>
            </CardContent>
        </Card>
    );
}

function EventIcon({ eventType }: { eventType: string }) {
    switch (eventType) {
        case 'death':
            return <Skull className="h-4 w-4 text-red-500" />;
        case 'ability_loss':
            return <AlertTriangle className="h-4 w-4 text-amber-500" />;
        case 'location_destruction':
            return <Shield className="h-4 w-4 text-purple-500" />;
        default:
            return <Calendar className="h-4 w-4 text-blue-500" />;
    }
}
