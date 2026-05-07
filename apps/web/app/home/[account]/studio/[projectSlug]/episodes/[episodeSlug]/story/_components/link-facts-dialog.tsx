'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

import { Check, Loader2, Search } from 'lucide-react';

import {
  getProjectFactsForLinkingAction,
  linkFactToEpisodeAction,
} from '@kit/episodes/server';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Checkbox } from '@kit/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
import { Input } from '@kit/ui/input';
import { toast } from '@kit/ui/sonner';

interface LinkFactsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  episodeId: string;
  projectId: string;
  linkedFactIds: string[];
  onFactsLinked: () => void;
}

interface ProjectFact {
  id: string;
  claim: string;
  simplified_claim: string | null;
  source_citation: string | null;
  verification_status: string;
  category: string | null;
}

export function LinkFactsDialog({
  open,
  onOpenChange,
  episodeId,
  projectId,
  linkedFactIds,
  onFactsLinked,
}: LinkFactsDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [facts, setFacts] = useState<ProjectFact[]>([]);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const loadFacts = useCallback(() => {
    startTransition(async () => {
      try {
        const result = await getProjectFactsForLinkingAction({
          projectId,
          search: search.trim() || undefined,
        });

        if (Array.isArray(result)) {
          setFacts(result as ProjectFact[]);
        }
      } catch {
        // Silent
      }
    });
  }, [projectId, search]);

  // n2: debounce search to avoid a DB query per keystroke
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(
        () => {
          loadFacts();
        },
        search ? 300 : 0,
      );
      setSelectedIds(new Set());
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [open, search, loadFacts]);

  const toggleFact = (factId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(factId)) {
        next.delete(factId);
      } else {
        next.add(factId);
      }
      return next;
    });
  };

  const handleLink = () => {
    if (selectedIds.size === 0) return;

    startTransition(async () => {
      try {
        const results = await Promise.allSettled(
          Array.from(selectedIds).map((factId) =>
            linkFactToEpisodeAction({ episodeId, factId }),
          ),
        );

        const succeeded = results.filter(
          (r) => r.status === 'fulfilled',
        ).length;
        const failed = results.filter((r) => r.status === 'rejected').length;

        if (failed === 0) {
          toast.success(`Linked ${succeeded} fact(s) to episode`);
        } else if (succeeded > 0) {
          toast.warning(`Linked ${succeeded} fact(s), ${failed} failed`);
        } else {
          toast.error('Failed to link facts');
        }

        onFactsLinked();
        onOpenChange(false);
      } catch {
        toast.error('Failed to link facts');
      }
    });
  };

  const availableFacts = facts.filter((f) => !linkedFactIds.includes(f.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>Link Facts to Episode</DialogTitle>
          <DialogDescription>
            Select verified facts from your project&apos;s library to link to
            this episode
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <Input
              placeholder="Search facts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Facts list */}
          <div className="max-h-[300px] space-y-1.5 overflow-y-auto">
            {isPending && availableFacts.length === 0 ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : availableFacts.length === 0 ? (
              <div className="text-muted-foreground py-6 text-center text-sm">
                {search
                  ? 'No matching facts found'
                  : 'No facts available. Add facts in the Research Hub first.'}
              </div>
            ) : (
              availableFacts.map((fact) => (
                <label
                  key={fact.id}
                  className="hover:bg-muted flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors"
                >
                  <Checkbox
                    checked={selectedIds.has(fact.id)}
                    onCheckedChange={() => toggleFact(fact.id)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug">
                      {fact.simplified_claim ?? fact.claim}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      {fact.source_citation && (
                        <span className="text-muted-foreground truncate text-xs">
                          {fact.source_citation}
                        </span>
                      )}
                      <Badge variant="outline" className="text-[10px]">
                        {fact.verification_status}
                      </Badge>
                    </div>
                  </div>
                </label>
              ))
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleLink}
            disabled={isPending || selectedIds.size === 0}
          >
            {isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-2 h-4 w-4" />
            )}
            Link {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
