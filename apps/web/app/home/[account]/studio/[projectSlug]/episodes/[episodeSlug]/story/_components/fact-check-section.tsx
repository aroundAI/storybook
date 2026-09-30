'use client';

import { useState, useTransition } from 'react';

import { CheckCircle2, Loader2, ShieldAlert } from 'lucide-react';

import { factCheckContentAction } from '@kit/episodes/server';
import { refusalMessage, unwrap } from '@kit/next/action-result';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { cn } from '@kit/ui/utils';

interface FactCheckSectionProps {
  projectId: string;
  storyContent: string;
}

type CheckState =
  | { phase: 'idle' }
  | { phase: 'error'; message: string }
  | {
      phase: 'done';
      check: Awaited<ReturnType<typeof factCheckContentAction>> & { ok: true };
    };

const SEVERITY_STYLES = {
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  warning:
    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  minor: 'bg-muted text-muted-foreground',
  info: 'bg-muted text-muted-foreground',
} as const;

/**
 * Checks the story against the project's verified facts (FILM-1123). It is
 * advice: it changes no fact, and what it flags is for a person to fix.
 */
export function FactCheckSection({
  projectId,
  storyContent,
}: FactCheckSectionProps) {
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<CheckState>({ phase: 'idle' });

  const runCheck = () => {
    startTransition(async () => {
      try {
        const data = await unwrap(
          factCheckContentAction({ projectId, content: storyContent }),
        );
        setState({ phase: 'done', check: { ok: true, data } });
      } catch (error) {
        setState({
          phase: 'error',
          message: refusalMessage(error, 'Could not fact-check the story'),
        });
      }
    });
  };

  const result = state.phase === 'done' ? state.check.data.result : null;
  const blocked = state.phase === 'done' && state.check.data.blocked;

  return (
    <div className="mt-4 space-y-2 border-t pt-3" data-test="fact-check">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium">Check story against facts</p>
        <Button
          size="sm"
          variant="outline"
          onClick={runCheck}
          disabled={isPending}
          data-test="fact-check-run"
        >
          {isPending ? (
            <Loader2 className="mr-2 h-3 w-3 animate-spin" />
          ) : null}
          {result ? 'Check again' : 'Fact-check'}
        </Button>
      </div>

      {state.phase === 'error' && (
        <p className="text-xs text-destructive" data-test="fact-check-error">
          {state.message}
        </p>
      )}

      {result && (
        <div className="space-y-2" data-test="fact-check-result">
          <div className="flex flex-wrap items-center gap-2">
            {blocked ? (
              <ShieldAlert className="h-4 w-4 text-destructive" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-green-600" />
            )}
            <Badge variant="outline" data-test="fact-check-verdict">
              {result.overallVerdict}
            </Badge>
            <span className="text-xs text-muted-foreground">
              accuracy {Math.round(result.accuracyScore * 100)}% -{' '}
              {result.verifiedClaims} of {result.totalClaimsFound} claims
              verified
            </span>
          </div>

          {blocked && (
            <p
              className="text-xs text-destructive"
              data-test="fact-check-blocked"
            >
              Hold this story back until the flags below are fixed.
            </p>
          )}

          <p className="text-xs text-muted-foreground">{result.summary}</p>

          {result.issues.length > 0 && (
            <ul className="space-y-1.5">
              {result.issues.map((issue, index) => (
                <li
                  key={`${index}-${issue.claimInContent}`}
                  className="rounded-md border p-2 text-xs"
                  data-test="fact-check-issue"
                >
                  <Badge
                    className={cn(
                      'mr-1.5 text-[10px]',
                      SEVERITY_STYLES[issue.severity],
                    )}
                  >
                    {issue.severity}
                  </Badge>
                  {issue.claimInContent && (
                    <span className="font-medium">
                      &ldquo;{issue.claimInContent}&rdquo;{' '}
                    </span>
                  )}
                  {issue.explanation}
                  {issue.suggestion && (
                    <span className="block text-muted-foreground">
                      {issue.suggestion}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {result.missingRequiredClaims.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Missing: {result.missingRequiredClaims.join('; ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
