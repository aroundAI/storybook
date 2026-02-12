'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';

import {
    BookOpen,
    LinkIcon,
    Loader2,
    Search,
    Trash2,
    Unlink,
} from 'lucide-react';

import {
    getEpisodeFactsAction,
    unlinkFactFromEpisodeAction,
} from '@kit/episodes/server';
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

interface EpisodeFact {
    id: string;
    fact_id: string;
    scene_reference: string | null;
    linked_at: string;
    verified_facts: {
        id: string;
        claim: string;
        simplified_claim: string | null;
        source_citation: string | null;
        verification_status: string;
        category: string | null;
        source_type: string;
    } | null;
}

const STATUS_COLORS: Record<string, string> = {
    verified: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    unverified: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
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
                if (Array.isArray(result)) {
                    setFacts(result as EpisodeFact[]);
                    onCountChange?.(result.length);
                }
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
                await unlinkFactFromEpisodeAction({ episodeId, factId });
                toast.success('Fact unlinked from episode');
                loadFacts();
            } catch {
                toast.error('Failed to unlink fact');
            }
        });
    };

    if (facts.length === 0 && !isPending) {
        return (
            <div className="flex flex-col items-center justify-center py-8 text-center">
                <BookOpen className="text-muted-foreground mb-3 h-8 w-8" />
                <h3 className="text-sm font-medium">No facts linked</h3>
                <p className="text-muted-foreground mt-1 max-w-xs text-xs">
                    Link verified facts from your project's research to ensure accuracy in
                    this episode.
                </p>
                <Button className="mt-4" size="sm" onClick={() => setShowLinkDialog(true)}>
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
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-xs">
                    {facts.length} fact{facts.length !== 1 ? 's' : ''} linked
                </p>
                <Button size="sm" variant="outline" onClick={() => setShowLinkDialog(true)}>
                    <LinkIcon className="mr-2 h-3 w-3" />
                    Link More
                </Button>
            </div>

            <div className="max-h-64 space-y-2 overflow-y-auto">
                {facts.map((fact) => {
                    const data = fact.verified_facts;
                    if (!data) return null;

                    return (
                        <Card key={fact.id} className="group">
                            <CardContent className="flex items-start gap-3 p-3">
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm leading-snug">
                                        {data.simplified_claim ?? data.claim}
                                    </p>
                                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                        {fact.scene_reference && (
                                            <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
                                                Scene: {fact.scene_reference}
                                            </Badge>
                                        )}
                                        {data.source_citation && (
                                            <span className="text-muted-foreground truncate text-xs">
                                                {data.source_citation}
                                            </span>
                                        )}
                                        <Badge
                                            variant="outline"
                                            className={`text-[10px] ${STATUS_COLORS[data.verification_status] ?? ''}`}
                                        >
                                            {data.verification_status}
                                        </Badge>
                                    </div>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100"
                                    onClick={() => handleUnlink(fact.fact_id)}
                                    disabled={isPending}
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
                linkedFactIds={facts.map((f) => f.fact_id)}
                onFactsLinked={loadFacts}
            />
        </div>
    );
}
