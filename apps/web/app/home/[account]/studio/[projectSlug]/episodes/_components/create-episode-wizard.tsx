'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import {
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  Lightbulb,
  Loader2,
  Palette,
  Plus,
  Search,
  Sparkles,
} from 'lucide-react';

import { DurationSelector } from '@kit/episodes/components';
import type { ContentStyle } from '@kit/episodes/lib';
import {
  createEpisodeWithContextAction,
  getProjectFactsForWizardAction,
} from '@kit/episodes/server/actions';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Checkbox } from '@kit/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import { ScrollArea } from '@kit/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { Separator } from '@kit/ui/separator';
import { toast } from '@kit/ui/sonner';
import { Textarea } from '@kit/ui/textarea';
import { cn } from '@kit/ui/utils';

interface Season {
  id: string;
  name: string;
  number: number;
}

interface FactItem {
  id: string;
  claim: string;
  category: string | null;
  sourceTitle: string | null;
  sourceCitation: string | null;
  confidenceScore: number | null;
}

interface CreateEpisodeWizardProps {
  projectId: string;
  projectSlug: string;
  account: string;
  seasons: Season[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type WizardStep = 'basics' | 'sources' | 'creative' | 'review';

const STEPS: { key: WizardStep; label: string; icon: React.ElementType }[] = [
  { key: 'basics', label: 'Basics', icon: FileText },
  { key: 'sources', label: 'Sources & Facts', icon: BookOpen },
  { key: 'creative', label: 'Creative Direction', icon: Palette },
  { key: 'review', label: 'Review & Create', icon: Check },
];

const VISUAL_TONE_PRESETS = [
  { value: 'stop-motion', label: 'Stop Motion' },
  { value: '2.5d', label: '2.5D' },
  { value: '3d', label: '3D Animation' },
  { value: '2d', label: '2D Animation' },
  { value: 'live-action', label: 'Live Action' },
  { value: 'mixed-media', label: 'Mixed Media' },
  { value: 'custom', label: 'Custom' },
];

export function CreateEpisodeWizard({
  projectId,
  projectSlug,
  account,
  seasons,
  open,
  onOpenChange,
}: CreateEpisodeWizardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Wizard state
  const [currentStep, setCurrentStep] = useState<WizardStep>('basics');

  // Step 1: Basics
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [seasonId, setSeasonId] = useState<string | undefined>();
  const [newSeasonName, setNewSeasonName] = useState('');
  const [isCreatingNewSeason, setIsCreatingNewSeason] = useState(false);

  // Step 2: Sources & Facts
  const [facts, setFacts] = useState<FactItem[]>([]);
  const [selectedFactIds, setSelectedFactIds] = useState<Set<string>>(
    new Set(),
  );
  const [factSearchQuery, setFactSearchQuery] = useState('');
  const [factsLoading, setFactsLoading] = useState(false);
  const [factsLoaded, setFactsLoaded] = useState(false);

  // Step 3: Creative Direction
  const [hook, setHook] = useState('');
  const [targetDuration, setTargetDuration] = useState(300);
  const [contentStyle, setContentStyle] =
    useState<ContentStyle>('dialogue-heavy');
  const [visualTone, setVisualTone] = useState('');
  const [customVisualTone, setCustomVisualTone] = useState('');
  const [toneNotes, setToneNotes] = useState('');

  // Reset on close
  useEffect(() => {
    if (!open) {
      setCurrentStep('basics');
      setTitle('');
      setDescription('');
      setSeasonId(undefined);
      setNewSeasonName('');
      setIsCreatingNewSeason(false);
      setSelectedFactIds(new Set());
      setFactSearchQuery('');
      setHook('');
      setTargetDuration(300);
      setContentStyle('dialogue-heavy');
      setVisualTone('');
      setCustomVisualTone('');
      setToneNotes('');
      setFactsLoaded(false);
    }
  }, [open]);

  // Load facts when entering sources step
  const loadFacts = useCallback(async () => {
    if (factsLoaded || factsLoading) return;
    setFactsLoading(true);
    try {
      const result = await getProjectFactsForWizardAction({ projectId });
      if (result.success) {
        setFacts(result.data.facts);
      }
    } catch {
      toast.error('Failed to load facts');
    } finally {
      setFactsLoading(false);
      setFactsLoaded(true);
    }
  }, [projectId, factsLoaded, factsLoading]);

  useEffect(() => {
    if (currentStep === 'sources' && !factsLoaded) {
      void loadFacts();
    }
  }, [currentStep, factsLoaded, loadFacts]);

  // Filtered facts
  const filteredFacts = facts.filter((fact) => {
    if (!factSearchQuery) return true;
    const q = factSearchQuery.toLowerCase();
    return (
      fact.claim.toLowerCase().includes(q) ||
      fact.category?.toLowerCase().includes(q) ||
      fact.sourceTitle?.toLowerCase().includes(q)
    );
  });

  // Group facts by category
  const factsByCategory = filteredFacts.reduce(
    (acc, fact) => {
      const category = fact.category || 'Uncategorized';
      if (!acc[category]) acc[category] = [];
      acc[category].push(fact);
      return acc;
    },
    {} as Record<string, FactItem[]>,
  );

  const toggleFact = (factId: string) => {
    setSelectedFactIds((prev) => {
      const next = new Set(prev);
      if (next.has(factId)) {
        next.delete(factId);
      } else {
        next.add(factId);
      }
      return next;
    });
  };

  const selectAllInCategory = (category: string) => {
    const categoryFacts = factsByCategory[category];
    if (!categoryFacts) return;
    setSelectedFactIds((prev) => {
      const next = new Set(prev);
      const allSelected = categoryFacts.every((f) => next.has(f.id));
      if (allSelected) {
        categoryFacts.forEach((f) => next.delete(f.id));
      } else {
        categoryFacts.forEach((f) => next.add(f.id));
      }
      return next;
    });
  };

  // Step navigation
  const stepIndex = STEPS.findIndex((s) => s.key === currentStep);

  const canGoNext = () => {
    if (currentStep === 'basics') return title.trim().length >= 1;
    return true;
  };

  const goNext = () => {
    const nextIndex = stepIndex + 1;
    if (nextIndex < STEPS.length) {
      setCurrentStep(STEPS[nextIndex]!.key);
    }
  };

  const goBack = () => {
    const prevIndex = stepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(STEPS[prevIndex]!.key);
    }
  };

  // Resolved visual tone
  const resolvedVisualTone =
    visualTone === 'custom' ? customVisualTone : visualTone;

  // Submit
  const handleCreate = (autoGenerate: boolean) => {
    startTransition(async () => {
      try {
        const result = await createEpisodeWithContextAction({
          projectId,
          title,
          description: description || undefined,
          seasonId: isCreatingNewSeason ? undefined : seasonId,
          newSeasonName: isCreatingNewSeason ? newSeasonName : undefined,
          factIds:
            selectedFactIds.size > 0 ? Array.from(selectedFactIds) : undefined,
          hook: hook || undefined,
          targetDuration: targetDuration || undefined,
          contentStyle,
          visualTone: resolvedVisualTone || undefined,
          toneNotes: toneNotes || undefined,
          autoGenerateStory: autoGenerate,
        });

        if (result.success && result.data) {
          const msg = autoGenerate
            ? 'Episode created — story generation started!'
            : 'Episode created successfully';
          toast.success(msg);
          onOpenChange(false);

          // Navigate to the episode
          const targetPage = autoGenerate ? 'story' : 'ideation';
          router.push(
            `/home/${account}/studio/${projectSlug}/episodes/${result.data.slug ?? result.data.id}/${targetPage}`,
          );
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Failed to create episode',
        );
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>Create Episode (Advanced)</DialogTitle>
          <DialogDescription>
            Set up your episode with sources, facts, and creative direction in
            one go.
          </DialogDescription>

          {/* Step indicators */}
          <div className="mt-3 flex items-center gap-1">
            {STEPS.map((step, i) => {
              const StepIcon = step.icon;
              const isActive = step.key === currentStep;
              const isCompleted = i < stepIndex;
              return (
                <div key={step.key} className="flex items-center">
                  {i > 0 && (
                    <div
                      className={cn(
                        'mx-1 h-px w-6',
                        isCompleted ? 'bg-primary' : 'bg-border',
                      )}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (i <= stepIndex || canGoNext()) {
                        setCurrentStep(step.key);
                      }
                    }}
                    className={cn(
                      'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                      isActive && 'bg-primary text-primary-foreground',
                      isCompleted && 'bg-primary/10 text-primary',
                      !isActive &&
                        !isCompleted &&
                        'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <StepIcon className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{step.label}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1 overflow-y-auto">
          <div className="space-y-6 p-6">
            {/* Step 1: Basics */}
            {currentStep === 'basics' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="wizard-title">
                    Episode Title <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="wizard-title"
                    placeholder="e.g., Why Popcorn Explodes"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={255}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="wizard-description">
                    Description (Optional)
                  </Label>
                  <Textarea
                    id="wizard-description"
                    placeholder="Brief description of what this episode covers..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    maxLength={2000}
                  />
                </div>

                <Separator />

                <div className="space-y-2">
                  <Label>Season</Label>
                  {!isCreatingNewSeason ? (
                    <div className="flex items-center gap-2">
                      <Select
                        value={seasonId ?? 'none'}
                        onValueChange={(v) =>
                          setSeasonId(v === 'none' ? undefined : v)
                        }
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="No season (standalone)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">
                            No season (standalone)
                          </SelectItem>
                          {seasons.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name || `Season ${s.number}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setIsCreatingNewSeason(true)}
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        New
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="Season name..."
                        value={newSeasonName}
                        onChange={(e) => setNewSeasonName(e.target.value)}
                        className="flex-1"
                        maxLength={255}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setIsCreatingNewSeason(false);
                          setNewSeasonName('');
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Step 2: Sources & Facts */}
            {currentStep === 'sources' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium">Verified Facts</h3>
                    <p className="text-xs text-muted-foreground">
                      Select facts that this episode should be built around.
                    </p>
                  </div>
                  {selectedFactIds.size > 0 && (
                    <Badge variant="secondary">
                      {selectedFactIds.size} selected
                    </Badge>
                  )}
                </div>

                {/* Search */}
                <div className="relative">
                  <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search facts by claim, category, or source..."
                    value={factSearchQuery}
                    onChange={(e) => setFactSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>

                {/* Facts list */}
                {factsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-sm text-muted-foreground">
                      Loading facts...
                    </span>
                  </div>
                ) : facts.length === 0 ? (
                  <div className="rounded-lg border border-dashed py-8 text-center">
                    <BookOpen className="mx-auto h-8 w-8 text-muted-foreground" />
                    <p className="mt-2 text-sm text-muted-foreground">
                      No verified facts found for this project.
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Upload research documents in the Research Hub to extract
                      facts first.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {Object.entries(factsByCategory).map(
                      ([category, categoryFacts]) => {
                        const allSelected = categoryFacts.every((f) =>
                          selectedFactIds.has(f.id),
                        );
                        return (
                          <div key={category} className="space-y-2">
                            <button
                              type="button"
                              onClick={() => selectAllInCategory(category)}
                              className="flex items-center gap-2 text-xs font-medium tracking-wider text-muted-foreground uppercase hover:text-foreground"
                            >
                              <Checkbox
                                checked={allSelected}
                                className="h-3 w-3"
                              />
                              {category} ({categoryFacts.length})
                            </button>
                            <div className="space-y-1">
                              {categoryFacts.map((fact) => (
                                <button
                                  key={fact.id}
                                  type="button"
                                  onClick={() => toggleFact(fact.id)}
                                  className={cn(
                                    'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                                    selectedFactIds.has(fact.id)
                                      ? 'border-primary bg-primary/5'
                                      : 'border-transparent hover:bg-muted/50',
                                  )}
                                >
                                  <Checkbox
                                    checked={selectedFactIds.has(fact.id)}
                                    className="mt-0.5"
                                  />
                                  <div className="flex-1 space-y-1">
                                    <p className="text-sm leading-snug">
                                      {fact.claim}
                                    </p>
                                    {fact.sourceTitle && (
                                      <p className="text-xs text-muted-foreground">
                                        Source: {fact.sourceTitle}
                                      </p>
                                    )}
                                  </div>
                                  {fact.confidenceScore !== null && (
                                    <Badge
                                      variant="outline"
                                      className="shrink-0 text-xs"
                                    >
                                      {Math.round(fact.confidenceScore * 100)}%
                                    </Badge>
                                  )}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      },
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Step 3: Creative Direction */}
            {currentStep === 'creative' && (
              <div className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="wizard-hook">
                    <Lightbulb className="mr-1 inline h-4 w-4" />
                    Episode Hook / Angle
                  </Label>
                  <Textarea
                    id="wizard-hook"
                    placeholder="What everyday assumption does this episode destroy? What's the surprising angle?"
                    value={hook}
                    onChange={(e) => setHook(e.target.value)}
                    rows={3}
                    maxLength={500}
                  />
                  <p className="text-xs text-muted-foreground">
                    This becomes the premise and logline for story generation.
                  </p>
                </div>

                <Separator />

                <DurationSelector
                  duration={targetDuration}
                  onDurationChange={setTargetDuration}
                  contentStyle={contentStyle}
                  onContentStyleChange={setContentStyle}
                />

                <Separator />

                <div className="space-y-2">
                  <Label>Visual Tone</Label>
                  <div className="flex flex-wrap gap-2">
                    {VISUAL_TONE_PRESETS.map((preset) => (
                      <button
                        key={preset.value}
                        type="button"
                        onClick={() => setVisualTone(preset.value)}
                        className={cn(
                          'rounded-md border px-3 py-1.5 text-sm transition-colors',
                          'border-border bg-background hover:bg-muted',
                          visualTone === preset.value &&
                            'border-primary bg-primary text-primary-foreground hover:bg-primary/90',
                        )}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  {visualTone === 'custom' && (
                    <Input
                      placeholder="Describe the visual style..."
                      value={customVisualTone}
                      onChange={(e) => setCustomVisualTone(e.target.value)}
                      maxLength={255}
                      className="mt-2"
                    />
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="wizard-tone-notes">
                    Additional Tone Notes (Optional)
                  </Label>
                  <Textarea
                    id="wizard-tone-notes"
                    placeholder="e.g., confrontational-witty-discovery tone. Must avoid boring lecture-style..."
                    value={toneNotes}
                    onChange={(e) => setToneNotes(e.target.value)}
                    rows={2}
                    maxLength={2000}
                  />
                </div>
              </div>
            )}

            {/* Step 4: Review & Create */}
            {currentStep === 'review' && (
              <div className="space-y-4">
                <h3 className="text-sm font-medium">Review Your Episode</h3>

                <div className="divide-y rounded-lg border">
                  {/* Basics */}
                  <div className="p-4">
                    <div className="mb-1 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                      Basics
                    </div>
                    <p className="font-medium">{title}</p>
                    {description && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {description}
                      </p>
                    )}
                    {(seasonId || newSeasonName) && (
                      <Badge variant="outline" className="mt-2">
                        {isCreatingNewSeason
                          ? `New: ${newSeasonName}`
                          : seasons.find((s) => s.id === seasonId)?.name ||
                            'Season'}
                      </Badge>
                    )}
                  </div>

                  {/* Facts */}
                  <div className="p-4">
                    <div className="mb-1 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                      Facts & Sources
                    </div>
                    {selectedFactIds.size > 0 ? (
                      <div className="space-y-1">
                        <p className="text-sm">
                          <span className="font-medium">
                            {selectedFactIds.size}
                          </span>{' '}
                          verified facts linked
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {Array.from(selectedFactIds)
                            .slice(0, 5)
                            .map((id) => {
                              const fact = facts.find((f) => f.id === id);
                              return fact ? (
                                <Badge
                                  key={id}
                                  variant="secondary"
                                  className="max-w-[200px] truncate text-xs"
                                >
                                  {fact.claim.slice(0, 40)}...
                                </Badge>
                              ) : null;
                            })}
                          {selectedFactIds.size > 5 && (
                            <Badge variant="outline" className="text-xs">
                              +{selectedFactIds.size - 5} more
                            </Badge>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No facts linked
                      </p>
                    )}
                  </div>

                  {/* Creative Direction */}
                  <div className="p-4">
                    <div className="mb-1 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                      Creative Direction
                    </div>
                    {hook && (
                      <p className="text-sm">
                        <span className="text-muted-foreground">Hook:</span>{' '}
                        {hook}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant="outline">
                        {Math.round(targetDuration / 60)} min
                      </Badge>
                      <Badge variant="outline">{contentStyle}</Badge>
                      {resolvedVisualTone && (
                        <Badge variant="outline">{resolvedVisualTone}</Badge>
                      )}
                    </div>
                    {toneNotes && (
                      <p className="mt-2 text-xs text-muted-foreground italic">
                        {toneNotes}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Footer with navigation */}
        <div className="flex items-center justify-between border-t px-6 py-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={goBack}
            disabled={stepIndex === 0 || isPending}
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back
          </Button>

          <div className="flex items-center gap-2">
            {currentStep !== 'review' ? (
              <Button
                type="button"
                size="sm"
                onClick={goNext}
                disabled={!canGoNext()}
              >
                Next
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleCreate(false)}
                  disabled={isPending}
                >
                  {isPending && (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  )}
                  Create Episode
                </Button>
                {hook && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => handleCreate(true)}
                    disabled={isPending}
                  >
                    {isPending ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="mr-1 h-4 w-4" />
                    )}
                    Create & Generate Story
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
