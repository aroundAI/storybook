'use client';

import { useCallback, useState } from 'react';

import { BookOpen, ChevronDown, ChevronRight, GitBranch } from 'lucide-react';

import type {
  NarrativeThread,
  NarrativeThreadStatus,
  NarrativeThreadType,
} from '@kit/episodes';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Checkbox } from '@kit/ui/checkbox';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ThreadCandidate {
  threadId: string;
  threadName: string;
  action: 'progress' | 'resolve';
}

interface ThreadCandidatesSelectorProps {
  threads: NarrativeThread[];
  onSelectionChange: (candidates: ThreadCandidate[]) => void;
}

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

const THREAD_TYPE_COLORS: Record<NarrativeThreadType, string> = {
  plot: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/25',
  character: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
  mystery: 'bg-purple-500/15 text-purple-400 border-purple-500/25',
  romantic: 'bg-rose-500/15 text-rose-400 border-rose-500/25',
  conflict: 'bg-red-500/15 text-red-400 border-red-500/25',
  thematic: 'bg-teal-500/15 text-teal-400 border-teal-500/25',
};

const STATUS_COLORS: Record<NarrativeThreadStatus, string> = {
  open: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  progressed: 'bg-sky-500/15 text-sky-400 border-sky-500/25',
  resolved: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/25',
  abandoned: 'bg-zinc-500/15 text-zinc-500 border-zinc-500/25',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCandidates(
  selected: Map<string, 'progress' | 'resolve'>,
  threads: NarrativeThread[],
): ThreadCandidate[] {
  return Array.from(selected.entries()).map(([id, action]) => ({
    threadId: id,
    threadName: threads.find((t) => t.id === id)?.threadName ?? '',
    action,
  }));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ThreadCandidatesSelector({
  threads,
  onSelectionChange,
}: ThreadCandidatesSelectorProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedThreads, setSelectedThreads] = useState<
    Map<string, 'progress' | 'resolve'>
  >(new Map());

  const activeThreads = threads.filter(
    (t) => t.status === 'open' || t.status === 'progressed',
  );

  const toggleThread = useCallback(
    (threadId: string) => {
      setSelectedThreads((prev) => {
        const next = new Map(prev);

        if (next.has(threadId)) {
          next.delete(threadId);
        } else {
          next.set(threadId, 'progress');
        }

        onSelectionChange(buildCandidates(next, threads));
        return next;
      });
    },
    [threads, onSelectionChange],
  );

  const toggleAction = useCallback(
    (threadId: string) => {
      setSelectedThreads((prev) => {
        const next = new Map(prev);
        const current = next.get(threadId);

        if (current) {
          next.set(threadId, current === 'progress' ? 'resolve' : 'progress');
        }

        onSelectionChange(buildCandidates(next, threads));
        return next;
      });
    },
    [threads, onSelectionChange],
  );

  // Nothing to show
  if (activeThreads.length === 0) {
    return null;
  }

  const selectedCount = selectedThreads.size;

  return (
    <Card className="border-dashed">
      <CardHeader
        className="cursor-pointer py-3"
        onClick={() => setIsExpanded((v) => !v)}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <GitBranch className="h-4 w-4" />
            Active Narrative Threads
            <Badge
              variant="secondary"
              className="ml-1 px-1.5 py-0 text-[10px] font-semibold"
            >
              {activeThreads.length}
            </Badge>
            {selectedCount > 0 && (
              <Badge className="bg-primary/15 text-primary border-primary/25 ml-0.5 border px-1.5 py-0 text-[10px] font-semibold">
                {selectedCount} selected
              </Badge>
            )}
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
          <p className="text-muted-foreground text-xs">
            Select threads to progress or resolve in the next story
          </p>
        )}
      </CardHeader>

      {/* Animated content wrapper */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
          isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          <CardContent className="space-y-2 pt-0 pb-4">
            {activeThreads.map((thread) => {
              const isSelected = selectedThreads.has(thread.id);
              const action = selectedThreads.get(thread.id);

              return (
                <div
                  key={thread.id}
                  className={`group rounded-lg border p-3 transition-all duration-200 ${
                    isSelected
                      ? 'border-primary/30 bg-primary/5 shadow-sm'
                      : 'border-border/50 hover:border-border hover:bg-muted/30'
                  }`}
                >
                  {/* Top row: checkbox + name + badges */}
                  <div className="flex items-start gap-2.5">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleThread(thread.id)}
                      className="mt-0.5 shrink-0"
                    />

                    <div className="min-w-0 flex-1">
                      {/* Name + type/status badges */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-semibold">
                          {thread.threadName}
                        </span>
                        <Badge
                          variant="outline"
                          className={`border px-1.5 py-0 text-[10px] capitalize ${THREAD_TYPE_COLORS[thread.threadType]}`}
                        >
                          {thread.threadType}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={`border px-1.5 py-0 text-[10px] capitalize ${STATUS_COLORS[thread.status]}`}
                        >
                          {thread.status}
                        </Badge>
                      </div>

                      {/* Description */}
                      {thread.description && (
                        <p className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-relaxed">
                          {thread.description}
                        </p>
                      )}

                      {/* Promises */}
                      {thread.promises && thread.promises.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          <BookOpen className="text-muted-foreground mt-px h-3 w-3 shrink-0" />
                          {thread.promises.slice(0, 4).map((promise, idx) => (
                            <Badge
                              key={idx}
                              variant="outline"
                              className="text-muted-foreground border-border/40 max-w-[180px] truncate px-1.5 py-0 text-[10px] font-normal"
                            >
                              {promise}
                            </Badge>
                          ))}
                          {thread.promises.length > 4 && (
                            <span className="text-muted-foreground self-center text-[10px]">
                              +{thread.promises.length - 4} more
                            </span>
                          )}
                        </div>
                      )}

                      {/* Action toggle – only when selected */}
                      {isSelected && (
                        <div className="mt-2.5 flex items-center gap-1">
                          <span className="text-muted-foreground mr-1 text-[10px] tracking-wider uppercase">
                            Action:
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (action !== 'progress')
                                toggleAction(thread.id);
                            }}
                            className={`rounded-l-md border px-2.5 py-1 text-[11px] font-medium transition-all duration-150 ${
                              action === 'progress'
                                ? 'border-sky-500/40 bg-sky-500/15 text-sky-400'
                                : 'border-border/50 text-muted-foreground hover:bg-muted/50'
                            }`}
                          >
                            Progress
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (action !== 'resolve') toggleAction(thread.id);
                            }}
                            className={`-ml-px rounded-r-md border px-2.5 py-1 text-[11px] font-medium transition-all duration-150 ${
                              action === 'resolve'
                                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400'
                                : 'border-border/50 text-muted-foreground hover:bg-muted/50'
                            }`}
                          >
                            Resolve
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </div>
      </div>
    </Card>
  );
}
