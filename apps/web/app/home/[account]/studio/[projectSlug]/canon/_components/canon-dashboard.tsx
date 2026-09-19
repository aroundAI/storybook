'use client';

/**
 * Canon Dashboard Client Component
 *
 * Interactive dashboard for viewing and filtering narrative threads
 * across all episodes in a project. Features stats overview, filter tabs,
 * and thread cards with rich metadata display.
 */
import { useMemo, useState } from 'react';

import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Clock,
  Eye,
  Filter,
  Heart,
  Layers,
  Lightbulb,
  Palette,
  ScrollText,
  Sparkles,
  Sword,
  TrendingUp,
  XCircle,
} from 'lucide-react';

import type {
  NarrativeThread,
  NarrativeThreadStatus,
  NarrativeThreadType,
} from '@kit/episodes/lib';
import { Badge } from '@kit/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { cn } from '@kit/ui/utils';

// =============================================================================
// CONSTANTS
// =============================================================================

const STATUS_TABS: Array<{
  value: NarrativeThreadStatus | 'all';
  label: string;
}> = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'progressed', label: 'Progressed' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'abandoned', label: 'Abandoned' },
];

const STATUS_CONFIG: Record<
  NarrativeThreadStatus,
  {
    color: string;
    bg: string;
    border: string;
    icon: React.ReactNode;
    label: string;
  }
> = {
  open: {
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/20',
    icon: <Clock className="h-3.5 w-3.5" />,
    label: 'Open',
  },
  progressed: {
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
    icon: <TrendingUp className="h-3.5 w-3.5" />,
    label: 'Progressed',
  },
  resolved: {
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/20',
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    label: 'Resolved',
  },
  abandoned: {
    color: 'text-gray-400',
    bg: 'bg-gray-500/10',
    border: 'border-gray-500/20',
    icon: <XCircle className="h-3.5 w-3.5" />,
    label: 'Abandoned',
  },
};

const THREAD_TYPE_CONFIG: Record<
  NarrativeThreadType,
  { color: string; bg: string; icon: React.ReactNode; label: string }
> = {
  plot: {
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
    icon: <Layers className="h-3 w-3" />,
    label: 'Plot',
  },
  character: {
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
    icon: <Eye className="h-3 w-3" />,
    label: 'Character',
  },
  mystery: {
    color: 'text-indigo-400',
    bg: 'bg-indigo-500/10',
    icon: <Lightbulb className="h-3 w-3" />,
    label: 'Mystery',
  },
  romantic: {
    color: 'text-pink-400',
    bg: 'bg-pink-500/10',
    icon: <Heart className="h-3 w-3" />,
    label: 'Romantic',
  },
  conflict: {
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    icon: <Sword className="h-3 w-3" />,
    label: 'Conflict',
  },
  thematic: {
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    icon: <Palette className="h-3 w-3" />,
    label: 'Thematic',
  },
};

// =============================================================================
// TYPES
// =============================================================================

interface CanonDashboardProps {
  threads: NarrativeThread[];
  projectName: string;
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function CanonDashboard({ threads, projectName }: CanonDashboardProps) {
  const [activeFilter, setActiveFilter] = useState<
    NarrativeThreadStatus | 'all'
  >('all');

  const stats = useMemo(() => {
    const total = threads.length;
    const open = threads.filter((t) => t.status === 'open').length;
    const progressed = threads.filter((t) => t.status === 'progressed').length;
    const resolved = threads.filter((t) => t.status === 'resolved').length;
    const abandoned = threads.filter((t) => t.status === 'abandoned').length;
    return { total, open, progressed, resolved, abandoned };
  }, [threads]);

  const filteredThreads = useMemo(() => {
    if (activeFilter === 'all') return threads;
    return threads.filter((t) => t.status === activeFilter);
  }, [threads, activeFilter]);

  return (
    <div className="space-y-6 pb-8">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatsCard
          label="Total Threads"
          value={stats.total}
          icon={<ScrollText className="h-4 w-4 text-slate-400" />}
          accentClass="from-slate-500/20 to-slate-600/5"
        />
        <StatsCard
          label="Open"
          value={stats.open + stats.progressed}
          icon={<Clock className="h-4 w-4 text-amber-400" />}
          accentClass="from-amber-500/20 to-amber-600/5"
          valueClass="text-amber-400"
        />
        <StatsCard
          label="Resolved"
          value={stats.resolved}
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-400" />}
          accentClass="from-emerald-500/20 to-emerald-600/5"
          valueClass="text-emerald-400"
        />
        <StatsCard
          label="Abandoned"
          value={stats.abandoned}
          icon={<XCircle className="h-4 w-4 text-gray-400" />}
          accentClass="from-gray-500/20 to-gray-600/5"
          valueClass="text-gray-400"
        />
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <div className="flex gap-1 rounded-lg bg-muted/50 p-1">
          {STATUS_TABS.map((tab) => {
            const isActive = activeFilter === tab.value;
            const count =
              tab.value === 'all'
                ? stats.total
                : stats[tab.value as keyof typeof stats];

            return (
              <button
                key={tab.value}
                onClick={() => setActiveFilter(tab.value)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all duration-200',
                  isActive
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-background/50 hover:text-foreground',
                )}
              >
                {tab.label}
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] leading-none tabular-nums',
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Thread List */}
      {filteredThreads.length === 0 ? (
        <EmptyState activeFilter={activeFilter} projectName={projectName} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredThreads.map((thread) => (
            <ThreadCard key={thread.id} thread={thread} />
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// STATS CARD
// =============================================================================

function StatsCard({
  label,
  value,
  icon,
  accentClass,
  valueClass,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  accentClass: string;
  valueClass?: string;
}) {
  return (
    <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-card to-card/80">
      <div
        className={cn(
          'absolute inset-0 bg-gradient-to-br opacity-60',
          accentClass,
        )}
      />
      <CardContent className="relative p-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className={cn('text-2xl font-bold tabular-nums', valueClass)}>
              {value}
            </p>
          </div>
          <div className="rounded-lg bg-background/50 p-2 backdrop-blur-sm">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// THREAD CARD
// =============================================================================

function ThreadCard({ thread }: { thread: NarrativeThread }) {
  const statusConfig = STATUS_CONFIG[thread.status];
  const typeConfig = THREAD_TYPE_CONFIG[thread.threadType];
  const createdDate = new Date(thread.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <Card className="group relative overflow-hidden border transition-all duration-200 hover:border-border/80 hover:shadow-md">
      {/* Status accent bar */}
      <div
        className={cn(
          'absolute top-0 left-0 h-full w-1 transition-all duration-200 group-hover:w-1.5',
          thread.status === 'open' && 'bg-amber-500',
          thread.status === 'progressed' && 'bg-blue-500',
          thread.status === 'resolved' && 'bg-emerald-500',
          thread.status === 'abandoned' && 'bg-gray-500',
        )}
      />

      <CardHeader className="space-y-2 pb-3 pl-5">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm leading-tight font-semibold">
            {thread.threadName}
          </CardTitle>

          {/* Status Badge */}
          <Badge
            variant="outline"
            className={cn(
              'shrink-0 gap-1 border text-[11px]',
              statusConfig.bg,
              statusConfig.border,
              statusConfig.color,
            )}
          >
            {statusConfig.icon}
            {statusConfig.label}
          </Badge>
        </div>

        {/* Type Badge */}
        <div className="flex items-center gap-2">
          <Badge
            variant="secondary"
            className={cn('gap-1 text-[11px]', typeConfig.bg, typeConfig.color)}
          >
            {typeConfig.icon}
            {typeConfig.label}
          </Badge>

          <span className="text-[11px] text-muted-foreground">
            {createdDate}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pt-0 pl-5">
        {/* Episode Origin */}
        {thread.openedEpisode && (
          <div className="flex items-center gap-1.5 text-xs">
            <BookOpen className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">Opened in</span>
            <span className="font-medium">
              Ep {thread.openedEpisode.number}: {thread.openedEpisode.title}
            </span>
          </div>
        )}

        {/* Resolved Episode */}
        {thread.resolvedEpisode && (
          <div className="flex items-center gap-1.5 text-xs">
            <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" />
            <span className="text-muted-foreground">Resolved in</span>
            <span className="font-medium">
              Ep {thread.resolvedEpisode.number}: {thread.resolvedEpisode.title}
            </span>
          </div>
        )}

        {/* Description */}
        {thread.description && (
          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {thread.description}
          </p>
        )}

        {/* Promises */}
        {thread.promises && thread.promises.length > 0 && (
          <div className="space-y-1.5">
            <p className="flex items-center gap-1 text-[11px] font-medium tracking-wider text-amber-400/80 uppercase">
              <Sparkles className="h-3 w-3" />
              Promises
            </p>
            <ul className="space-y-1">
              {thread.promises.slice(0, 3).map((promise, i) => (
                <li
                  key={i}
                  className="flex items-start gap-1.5 text-xs text-muted-foreground"
                >
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-400/60" />
                  <span className="line-clamp-1">{promise}</span>
                </li>
              ))}
              {thread.promises.length > 3 && (
                <li className="text-[11px] text-muted-foreground">
                  +{thread.promises.length - 3} more
                </li>
              )}
            </ul>
          </div>
        )}

        {/* Payoffs */}
        {thread.payoffs && thread.payoffs.length > 0 && (
          <div className="space-y-1.5">
            <p className="flex items-center gap-1 text-[11px] font-medium tracking-wider text-emerald-400/80 uppercase">
              <CheckCircle2 className="h-3 w-3" />
              Payoffs
            </p>
            <ul className="space-y-1">
              {thread.payoffs.slice(0, 3).map((payoff, i) => (
                <li
                  key={i}
                  className="flex items-start gap-1.5 text-xs text-muted-foreground"
                >
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-emerald-400/60" />
                  <span className="line-clamp-1">{payoff}</span>
                </li>
              ))}
              {thread.payoffs.length > 3 && (
                <li className="text-[11px] text-muted-foreground">
                  +{thread.payoffs.length - 3} more
                </li>
              )}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// EMPTY STATE
// =============================================================================

function EmptyState({
  activeFilter,
  projectName,
}: {
  activeFilter: NarrativeThreadStatus | 'all';
  projectName: string;
}) {
  const isFiltered = activeFilter !== 'all';

  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center py-16">
        <div className="mb-4 rounded-full bg-muted/50 p-4">
          {isFiltered ? (
            <AlertTriangle className="h-8 w-8 text-muted-foreground" />
          ) : (
            <ScrollText className="h-8 w-8 text-muted-foreground" />
          )}
        </div>
        <CardTitle className="mb-2 text-lg">
          {isFiltered
            ? `No ${activeFilter} threads`
            : 'No narrative threads yet'}
        </CardTitle>
        <CardDescription className="max-w-sm text-center">
          {isFiltered
            ? `There are no threads with "${activeFilter}" status in ${projectName}. Try a different filter.`
            : `Narrative threads are automatically created when stories are generated. Start writing episodes in ${projectName} to see story arcs appear here.`}
        </CardDescription>
      </CardContent>
    </Card>
  );
}
