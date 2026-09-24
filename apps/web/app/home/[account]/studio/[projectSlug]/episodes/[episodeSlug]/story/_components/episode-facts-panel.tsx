'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';

import { BookOpen, LinkIcon, Unlink } from 'lucide-react';

import {
  getEpisodeFactsAction,
  unlinkFactFromEpisodeAction,
} from '@kit/episodes/server';
import { refusalMessage, unwrap } from '@kit/next/action-result';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Card, CardContent } from '@kit/ui/card';
import { toast } from '@kit/ui/sonner';

import { LinkFactsDialog } from './link-facts-dialog';

interface EpisodeFactsPanelProps {
  episodeId: string;
  projectId: string;
  onCountChange?: (count: number) => void;
}

type EpisodeFact = Awaited<
  ReturnType<typeof getEpisodeFactsAction>
>['facts'][number];

const STATUS_COLORS: Record<string, string> = {
  verified:
    'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  unverified:
    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  disputed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

export function EpisodeFactsPanel({
  episodeId,
  projectId,
  onCountChange,
}: EpisodeFactsPanelProps) {
  const [isPending, startTransition] = useTransition();
  const [facts, setFacts] = useState<EpisodeFact[]>([]);
  const [showLinkDialog, setShowLinkDialog] = useState(false);

  const loadFacts = useCallback(() => {
    startTransition(async () => {
      try {
        const result = await getEpisodeFactsAction({ episodeId });
        setFacts(result.facts);
        onCountChange?.(result.totalCount);
      } catch {
        // Silent — empty state handles it
      }
    });
  }, [episodeId, onCountChange]);

  useEffect(() => {
    loadFacts();
  }, [loadFacts]);

  const handleUnlink = (factId: string) => {
    startTransition(async () => {
      try {
        await unwrap(unlinkFactFromEpisodeAction({ episodeId, factId }));
        toast.success('Fact unlinked from episode');
      } catch (error) {
        toast.error(refusalMessage(error, 'Failed to unlink fact'));
      }
      loadFacts();
    });
  };

  if (facts.length === 0 && !isPending) {
    return (
      <div
        className="flex flex-col items-center justify-center py-8 text-center"
        data-test="episode-facts-empty"
      >
        <BookOpen className="mb-3 h-8 w-8 text-muted-foreground" />
        <h3 className="text-sm font-medium">No facts linked</h3>
        <p className="mt-1 max-w-xs text-xs text-muted-foreground">
          Link verified facts from your project&apos;s research to ensure
          accuracy in this episode.
        </p>
        <Button
          className="mt-4"
          size="sm"
          onClick={() => setShowLinkDialog(true)}
          data-test="episode-facts-link"
        >
          <LinkIcon className="mr-2 h-3 w-3" />
          Link Facts
        </Button>

        <LinkFactsDialog
          open={showLinkDialog}
          onOpenChange={setShowLinkDialog}
          episodeId={episodeId}
          projectId={projectId}
          linkedFactIds={[]}
          onFactsLinked={loadFacts}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3" data-test="episode-facts-panel">
      <div className="flex items-center justify-between">
        <p
          className="text-xs text-muted-foreground"
          data-test="episode-facts-count"
        >
          {facts.length} fact{facts.length !== 1 ? 's' : ''} linked
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowLinkDialog(true)}
          data-test="episode-facts-link"
        >
          <LinkIcon className="mr-2 h-3 w-3" />
          Link More
        </Button>
      </div>

      <div className="max-h-64 space-y-2 overflow-y-auto">
        {facts.map((fact) => {
          return (
            <Card key={fact.id} className="group" data-test="episode-fact-card">
              <CardContent className="flex items-start gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug">
                    {fact.simplifiedClaim ?? fact.claim}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    {fact.sceneReference && (
                      <Badge
                        variant="outline"
                        className="bg-blue-50 text-[10px] text-blue-700 dark:bg-blue-900/20 dark:text-blue-300"
                      >
                        Scene: {fact.sceneReference}
                      </Badge>
                    )}
                    {fact.sourceCitation && (
                      <span className="truncate text-xs text-muted-foreground">
                        {fact.sourceCitation}
                      </span>
                    )}
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${STATUS_COLORS[fact.verificationStatus] ?? ''}`}
                    >
                      {fact.verificationStatus}
                    </Badge>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => handleUnlink(fact.id)}
                  disabled={isPending}
                  aria-label="Unlink fact"
                  data-test="episode-fact-unlink"
                >
                  <Unlink className="h-3 w-3 text-destructive" />
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <LinkFactsDialog
        open={showLinkDialog}
        onOpenChange={setShowLinkDialog}
        episodeId={episodeId}
        projectId={projectId}
        linkedFactIds={facts.map((f) => f.id)}
        onFactsLinked={loadFacts}
      />
    </div>
  );
}
