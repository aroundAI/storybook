'use client';

import { useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Info,
  RefreshCw,
  Wand2,
} from 'lucide-react';

import { refusalMessage, unwrap } from '@kit/next/action-result';
import { Alert, AlertDescription } from '@kit/ui/alert';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { ScrollArea } from '@kit/ui/scroll-area';
import { toast } from '@kit/ui/sonner';

import type {
  ContinuityIssue,
  ContinuityIssueSeverity,
  IssueLocation,
} from '../lib/continuity-types';
import {
  checkContinuityAction,
  fixContinuityIssueAction,
} from '../server/continuity-actions';

interface ContinuityCheckerProps {
  /** ID of the episode to check */
  episodeId: string;
  /** Callback when user clicks to navigate to an issue location */
  onNavigate?: (location: IssueLocation) => void;
}

const SEVERITY_CONFIG: Record<
  ContinuityIssueSeverity,
  { icon: typeof AlertTriangle; colorClass: string; bgClass: string }
> = {
  error: {
    icon: AlertTriangle,
    colorClass: 'text-red-500',
    bgClass: 'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-900',
  },
  warning: {
    icon: AlertTriangle,
    colorClass: 'text-amber-500',
    bgClass:
      'bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900',
  },
  suggestion: {
    icon: Info,
    colorClass: 'text-blue-500',
    bgClass:
      'bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-900',
  },
};

/**
 * Continuity Checker Component
 *
 * Displays continuity issues detected in episode content with
 * severity-based filtering, navigation, and auto-fix capabilities.
 */
export function ContinuityChecker({
  episodeId,
  onNavigate,
}: ContinuityCheckerProps) {
  const [expandedIssue, setExpandedIssue] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const {
    data: result,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['continuity-check', episodeId],
    queryFn: async () => {
      const response = await checkContinuityAction({ episodeId });
      return response.data;
    },
    staleTime: 60 * 1000, // 1 minute
  });

  const fixMutation = useMutation({
    mutationFn: (input: Parameters<typeof fixContinuityIssueAction>[0]) =>
      unwrap(fixContinuityIssueAction(input)),
    onSuccess: () => {
      toast.success('Issue fixed successfully');
      void queryClient.invalidateQueries({
        queryKey: ['continuity-check', episodeId],
      });
    },
    onError: (error) => {
      toast.error(refusalMessage(error, 'Failed to fix issue'));
    },
  });

  const issues = result?.issues ?? [];
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const suggestionCount = issues.filter(
    (i) => i.severity === 'suggestion',
  ).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              Continuity Checker
              {!isLoading && issues.length === 0 && (
                <CheckCircle className="h-5 w-5 text-green-500" />
              )}
            </CardTitle>
            <CardDescription>
              Analyze your content for continuity issues
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={isLoading}
          >
            <RefreshCw
              className={`mr-1 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
            />
            {isLoading ? 'Checking...' : 'Re-check'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary Badges */}
        <div className="flex flex-wrap gap-4">
          <Badge variant="destructive" className="flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            {errorCount} Errors
          </Badge>
          <Badge
            variant="outline"
            className="flex items-center gap-1 border-amber-300 text-amber-600 dark:border-amber-700 dark:text-amber-400"
          >
            <AlertTriangle className="h-3 w-3" />
            {warningCount} Warnings
          </Badge>
          <Badge variant="outline" className="flex items-center gap-1">
            <Info className="h-3 w-3" />
            {suggestionCount} Suggestions
          </Badge>
        </div>

        {/* Error State */}
        {isError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Failed to check continuity. Please try again.
            </AlertDescription>
          </Alert>
        )}

        {/* Empty State */}
        {!isLoading && !isError && issues.length === 0 && (
          <Alert>
            <CheckCircle className="h-4 w-4 text-green-500" />
            <AlertDescription>
              No continuity issues detected. Your content is consistent!
            </AlertDescription>
          </Alert>
        )}

        {/* Issues List */}
        {issues.length > 0 && (
          <ScrollArea className="h-96">
            <div className="space-y-2 pr-4">
              {issues.map((issue) => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  isExpanded={expandedIssue === issue.id}
                  onToggle={() =>
                    setExpandedIssue(
                      expandedIssue === issue.id ? null : issue.id,
                    )
                  }
                  onNavigate={onNavigate}
                  onFix={
                    issue.autoFixable
                      ? () =>
                          fixMutation.mutate({
                            episodeId,
                            issueId: issue.id,
                          })
                      : undefined
                  }
                  isFixing={fixMutation.isPending}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

interface IssueCardProps {
  issue: ContinuityIssue;
  isExpanded: boolean;
  onToggle: () => void;
  onNavigate?: (location: IssueLocation) => void;
  onFix?: () => void;
  isFixing: boolean;
}

function IssueCard({
  issue,
  isExpanded,
  onToggle,
  onNavigate,
  onFix,
  isFixing,
}: IssueCardProps) {
  const config = SEVERITY_CONFIG[issue.severity];
  const Icon = config.icon;

  return (
    <div className={`rounded-lg border ${config.bgClass}`}>
      <button
        onClick={onToggle}
        className="flex w-full items-start gap-3 p-3 text-left"
        type="button"
      >
        <Icon className={`h-5 w-5 ${config.colorClass} mt-0.5 flex-shrink-0`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{issue.title}</span>
            <Badge variant="outline" className="text-xs">
              {issue.type.replace(/_/g, ' ')}
            </Badge>
          </div>
          <p className="line-clamp-1 text-sm text-muted-foreground">
            {issue.description}
          </p>
        </div>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        )}
      </button>

      {isExpanded && (
        <div className="space-y-3 px-3 pb-3">
          {/* Full Description */}
          <p className="text-sm">{issue.description}</p>

          {/* Locations */}
          {issue.locations.length > 0 && (
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                Found in:
              </span>
              {issue.locations.map((loc, i) => (
                <button
                  key={i}
                  onClick={() => onNavigate?.(loc)}
                  className="block w-full rounded bg-background p-2 text-left text-sm transition-colors hover:bg-muted"
                  type="button"
                  disabled={!onNavigate}
                >
                  <span className="font-medium capitalize">{loc.type}</span>
                  {loc.sceneNumber !== undefined &&
                    ` - Scene ${loc.sceneNumber}`}
                  {loc.shotNumber !== undefined && ` - Shot ${loc.shotNumber}`}
                  {loc.excerpt && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      &quot;{loc.excerpt}&quot;
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Suggestion */}
          {issue.suggestion && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-sm">
                <strong>Suggestion:</strong> {issue.suggestion}
              </AlertDescription>
            </Alert>
          )}

          {/* Auto-fix Button */}
          {onFix && (
            <Button size="sm" onClick={onFix} disabled={isFixing}>
              <Wand2 className="mr-1 h-4 w-4" />
              {isFixing ? 'Fixing...' : 'Auto-fix'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
