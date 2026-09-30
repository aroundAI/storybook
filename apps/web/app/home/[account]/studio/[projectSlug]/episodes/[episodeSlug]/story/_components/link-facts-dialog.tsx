'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

import { Check, Loader2, Search } from 'lucide-react';
import { z } from 'zod';

import {
  getEpisodeSceneOptionsAction,
  getProjectFactsAction,
  linkFactsToEpisodeAction,
} from '@kit/episodes/server';
import { refusalMessage, unwrap } from '@kit/next/action-result';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { toast } from '@kit/ui/sonner';

interface LinkFactsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  episodeId: string;
  projectId: string;
  linkedFactIds: string[];
  onFactsLinked: () => void;
}

const NO_SCENE = 'none';

interface SceneOption {
  value: string;
  label: string;
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
  const [scenes, setScenes] = useState<SceneOption[]>([]);
  const [sceneReference, setSceneReference] = useState(NO_SCENE);

  const loadFacts = useCallback(() => {
    startTransition(async () => {
      try {
        const result = await getProjectFactsAction({
          projectId,
          search: search.trim() || undefined,
          limit: 50,
          offset: 0,
        });

        const resultSchema = z.object({
          facts: z.array(
            z.object({
              id: z.string(),
              claim: z.string(),
              simplifiedClaim: z.string().nullable(),
              sourceCitation: z.string().nullable(),
              verificationStatus: z.string(),
              category: z.string().nullable(),
            }),
          ),
        });
        const parsed = resultSchema.safeParse(result);
        if (parsed.success) {
          setFacts(
            parsed.data.facts.map((f) => ({
              id: f.id,
              claim: f.claim,
              simplified_claim: f.simplifiedClaim,
              source_citation: f.sourceCitation,
              verification_status: f.verificationStatus,
              category: f.category,
            })),
          );
        }
      } catch {
        // Silent
      }
    });
  }, [projectId, search]);

  const loadScenes = useCallback(async () => {
    try {
      const result = await getEpisodeSceneOptionsAction({ episodeId });
      setScenes(result.scenes);
    } catch {
      setScenes([]);
    }
  }, [episodeId]);

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
      setSceneReference(NO_SCENE);
      void loadScenes();
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [open, search, loadFacts, loadScenes]);

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
        const { linkedCount } = await unwrap(
          linkFactsToEpisodeAction({
            episodeId,
            factIds: Array.from(selectedIds),
            ...(sceneReference === NO_SCENE ? {} : { sceneReference }),
          }),
        );

        toast.success(`Linked ${linkedCount} fact(s) to episode`);
        onFactsLinked();
        onOpenChange(false);
      } catch (error) {
        toast.error(refusalMessage(error, 'Failed to link facts'));
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
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
              <div className="py-6 text-center text-sm text-muted-foreground">
                {search
                  ? 'No matching facts found'
                  : 'No facts available. Add facts in the Research Hub first.'}
              </div>
            ) : (
              availableFacts.map((fact) => (
                <label
                  key={fact.id}
                  data-test="link-fact-option"
                  className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted"
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
                        <span className="truncate text-xs text-muted-foreground">
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

        {scenes.length > 0 && (
          <div className="space-y-1.5" data-test="link-facts-scene">
            <p className="text-sm font-medium">Used in scene (optional)</p>
            <Select value={sceneReference} onValueChange={setSceneReference}>
              <SelectTrigger data-test="link-facts-scene-select">
                <SelectValue placeholder="No scene" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SCENE}>No scene</SelectItem>
                {scenes.map((scene) => (
                  <SelectItem key={scene.value} value={scene.value}>
                    {scene.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleLink}
            disabled={isPending || selectedIds.size === 0}
            data-test="link-facts-submit"
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
