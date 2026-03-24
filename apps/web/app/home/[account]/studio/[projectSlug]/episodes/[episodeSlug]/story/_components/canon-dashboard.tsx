'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';

import {
    AlertTriangle,
    BookOpen,
    Calendar,
    ChevronDown,
    ChevronRight,
    FileText,
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
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from '@kit/ui/collapsible';
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
    const [factsCount, setFactsCount] = useState<number | null>(null);

    const loadData = useCallback(() => {
        if (!canonEnabled) return;

        startTransition(async () => {
            const [eventsResult, threadsResult, statesResult] = await Promise.all([
                getImmutableEventsAction({ projectId }),
                getActiveThreadsAction({ projectId }),
                getProjectCharacterStatesAction({ projectId, limit: 20 }),
            ]);

            if (Array.isArray(eventsResult)) setEvents(eventsResult);
            if (Array.isArray(threadsResult)) setThreads(threadsResult);
            if (Array.isArray(statesResult)) setCharacterStates(statesResult);
        });
    }, [projectId, canonEnabled]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const toggleEvent = (eventId: string) => {
        setExpandedEvents((prev) => {
            const next = new Set(prev);
            if (next.has(eventId)) next.delete(eventId);
            else next.add(eventId);
            return next;
        });
    };

    if (!canonEnabled) {
        return (
            <div className="flex flex-col items-center justify-center py-12 text-center">
                <Shield className="mb-3 h-10 w-10 text-muted-foreground opacity-40" />
                <h3 className="text-sm font-medium">Canon Management Disabled</h3>
                <p className="mt-1.5 max-w-[200px] text-xs leading-relaxed text-muted-foreground">
                    Enable Canon Management in Project Settings to track story continuity
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-violet-500" />
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">
                        Canon Timeline
                    </span>
                    <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                        Ep.{episodeNumber}
                    </Badge>
                </div>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground"
                    onClick={loadData}
                    disabled={isPending}
                >
                    {isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                    )}
                </Button>
            </div>

            <Tabs defaultValue="events" className="w-full">
                {/* 2×2 compact tab grid */}
                <TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1">
                    <TabsTrigger
                        value="events"
                        className="flex items-center gap-1.5 py-1.5 text-xs"
                    >
                        <Calendar className="h-3 w-3 shrink-0" />
                        Events
                        {events.length > 0 && (
                            <span className="ml-auto rounded bg-primary/15 px-1 text-[10px] font-medium text-primary">
                                {events.length}
                            </span>
                        )}
                    </TabsTrigger>
                    <TabsTrigger
                        value="threads"
                        className="flex items-center gap-1.5 py-1.5 text-xs"
                    >
                        <GitBranch className="h-3 w-3 shrink-0" />
                        Threads
                        {threads.length > 0 && (
                            <span className="ml-auto rounded bg-primary/15 px-1 text-[10px] font-medium text-primary">
                                {threads.length}
                            </span>
                        )}
                    </TabsTrigger>
                    <TabsTrigger
                        value="characters"
                        className="flex items-center gap-1.5 py-1.5 text-xs"
                    >
                        <User className="h-3 w-3 shrink-0" />
                        Characters
                        {characterStates.length > 0 && (
                            <span className="ml-auto rounded bg-primary/15 px-1 text-[10px] font-medium text-primary">
                                {characterStates.length}
                            </span>
                        )}
                    </TabsTrigger>
                    <TabsTrigger
                        value="facts"
                        className="flex items-center gap-1.5 py-1.5 text-xs"
                    >
                        <FileText className="h-3 w-3 shrink-0" />
                        Facts
                        {factsCount !== null && factsCount > 0 && (
                            <span className="ml-auto rounded bg-primary/15 px-1 text-[10px] font-medium text-primary">
                                {factsCount}
                            </span>
                        )}
                    </TabsTrigger>
                </TabsList>

                {/* Events */}
                <TabsContent value="events" className="mt-3 space-y-2">
                    {events.length === 0 ? (
                        <EmptyState
                            icon={<Calendar className="h-7 w-7" />}
                            title="No immutable events"
                            description="Key events are auto-extracted after story generation, or add them manually."
                        >
                            <AddEventDialog
                                projectId={projectId}
                                episodeId={episodeId}
                                season={season}
                                episodeNumber={episodeNumber}
                                onEventAdded={loadData}
                            />
                        </EmptyState>
                    ) : (
                        <>
                            {events.map((event) => (
                                <Collapsible
                                    key={event.id}
                                    open={expandedEvents.has(event.id)}
                                    onOpenChange={() => toggleEvent(event.id)}
                                >
                                    <CollapsibleTrigger asChild>
                                        <div className="flex cursor-pointer items-center gap-2 rounded-lg border border-border/60 bg-card/60 p-2.5 transition-colors hover:bg-muted/50">
                                            {expandedEvents.has(event.id) ? (
                                                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                            ) : (
                                                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                            )}
                                            <EventIcon eventType={event.eventType} />
                                            <span className="min-w-0 flex-1 truncate text-xs font-medium">
                                                {event.eventKey}
                                            </span>
                                            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                                                Ep.{event.episodeNumber}
                                            </Badge>
                                        </div>
                                    </CollapsibleTrigger>
                                    <CollapsibleContent className="ml-5 mt-1 rounded-md bg-muted/30 p-2.5">
                                        <p className="text-xs leading-relaxed text-muted-foreground">{event.description}</p>
                                        <p className="mt-1.5 text-[10px] text-muted-foreground/60">
                                            {new Date(event.createdAt).toLocaleDateString()}
                                        </p>
                                    </CollapsibleContent>
                                </Collapsible>
                            ))}
                            <AddEventDialog
                                projectId={projectId}
                                episodeId={episodeId}
                                season={season}
                                episodeNumber={episodeNumber}
                                onEventAdded={loadData}
                            />
                        </>
                    )}
                </TabsContent>

                {/* Threads */}
                <TabsContent value="threads" className="mt-3 space-y-2">
                    {threads.length === 0 ? (
                        <EmptyState
                            icon={<GitBranch className="h-7 w-7" />}
                            title="No narrative threads"
                            description="Threads track story arcs across episodes. They're auto-created after story generation."
                        >
                            <AddThreadDialog
                                projectId={projectId}
                                episodeId={episodeId}
                                onThreadAdded={loadData}
                            />
                        </EmptyState>
                    ) : (
                        <>
                            {threads.map((thread) => (
                                <div
                                    key={thread.id}
                                    className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-card/60 p-2.5"
                                >
                                    <GitBranch className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-xs font-medium">{thread.threadName}</p>
                                        {thread.description && (
                                            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                                                {thread.description}
                                            </p>
                                        )}
                                    </div>
                                    <Badge
                                        variant={
                                            thread.status === 'open'
                                                ? 'default'
                                                : thread.status === 'resolved'
                                                    ? 'secondary'
                                                    : 'outline'
                                        }
                                        className="shrink-0 text-[10px]"
                                    >
                                        {thread.status}
                                    </Badge>
                                </div>
                            ))}
                            <AddThreadDialog
                                projectId={projectId}
                                episodeId={episodeId}
                                onThreadAdded={loadData}
                            />
                        </>
                    )}
                </TabsContent>

                {/* Characters */}
                <TabsContent value="characters" className="mt-3 space-y-2">
                    {characterStates.length === 0 ? (
                        <EmptyState
                            icon={<User className="h-7 w-7" />}
                            title="No character states"
                            description="Character arcs are auto-tracked after story generation."
                        />
                    ) : (
                        characterStates.map((state) => (
                            <div
                                key={state.id}
                                className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-card/60 p-2.5"
                            >
                                <User className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-xs font-medium">
                                        {state.characters?.name ?? state.character_id}
                                    </p>
                                    <p className="text-[11px] text-muted-foreground">
                                        {state.state_type}
                                    </p>
                                    {state.trigger_event && (
                                        <p className="mt-0.5 text-[10px] text-muted-foreground/60">
                                            Trigger: {state.trigger_event}
                                        </p>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </TabsContent>

                {/* Facts */}
                <TabsContent value="facts" className="mt-3">
                    <EpisodeFactsPanel
                        episodeId={episodeId}
                        projectId={projectId}
                        onCountChange={setFactsCount}
                    />
                </TabsContent>
            </Tabs>
        </div>
    );
}

// ─── Shared empty state ──────────────────────────────────────────────────────

function EmptyState({
    icon,
    title,
    description,
    children,
}: {
    icon: React.ReactNode;
    title: string;
    description: string;
    children?: React.ReactNode;
}) {
    return (
        <div className="flex flex-col items-center py-8 text-center">
            <div className="mb-2 text-muted-foreground/40">{icon}</div>
            <p className="text-xs font-medium text-muted-foreground">{title}</p>
            <p className="mt-1 max-w-[200px] text-[11px] leading-relaxed text-muted-foreground/60">
                {description}
            </p>
            {children && <div className="mt-3">{children}</div>}
        </div>
    );
}

// ─── Event icon ──────────────────────────────────────────────────────────────

function EventIcon({ eventType }: { eventType: string }) {
    switch (eventType) {
        case 'death':
            return <Skull className="h-3.5 w-3.5 text-red-500" />;
        case 'ability_loss':
            return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
        default:
            return <Calendar className="h-3.5 w-3.5 text-blue-500" />;
    }
}
