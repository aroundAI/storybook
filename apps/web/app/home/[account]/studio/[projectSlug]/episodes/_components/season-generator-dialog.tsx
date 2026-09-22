'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

import Link from 'next/link';
import { useParams } from 'next/navigation';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  Eye,
  Heart,
  ListChecks,
  Loader2,
  MapPin,
  MessageCircle,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Timer,
  Users,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import ReactMarkdown from 'react-markdown';

import { useAssets } from '@kit/assets/hooks';
import { AnalyzeSeasonSchema } from '@kit/episodes/schemas';
import {
  getResearchCountsAction,
  getVerifiedFactsAction,
} from '@kit/episodes/server';
import {
  analyzeSeasonRoadmapAction,
  generateSeasonEpisodesAction,
} from '@kit/episodes/server/season-generation';
import { refusalMessage } from '@kit/next/action-result';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@kit/ui/dialog';
import { Form, FormControl, FormField, FormItem } from '@kit/ui/form';
import { useLlmJob } from '@kit/ui/hooks';
import { Input } from '@kit/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { toast } from '@kit/ui/sonner';
import { Textarea } from '@kit/ui/textarea';
import { cn } from '@kit/ui/utils';

interface SeasonGeneratorDialogProps {
  projectId: string;
}

type Step = 'premise' | 'assets' | 'generate';

interface EpisodeBeat {
  label: string;
  content: string;
}

interface AnalysisResult {
  premise: string;
  tone?: string | null;
  target_audience?: string | null;
  characters: Array<{
    name: string;
    role: string;
    description: string;
    physicalDescription?: string;
    clothingStyle?: string;
    mannerisms?: string;
  }>;
  locations: Array<{
    name: string;
    setting: string;
    description: string;
    visualDescription?: string;
    timeOfDay?: string | null;
    weather?: string | null;
  }>;
  episodes: Array<{
    number: number;
    title: string;
    synopsis: string;
    beats: EpisodeBeat[];
    moral?: string | null;
    signature_line?: string | null;
    character_names?: string[];
    location_names?: string[];
    tags?: string[];
    description?: string; // Legacy support
  }>;
}

// Step Indicator Component
function StepIndicator({ currentStep }: { currentStep: Step }) {
  const steps = [
    { id: 'premise', label: 'Premise', number: 1 },
    { id: 'assets', label: 'Assets', number: 2 },
    { id: 'generate', label: 'Generate', number: 3 },
  ];

  const getStepIndex = (step: Step) => steps.findIndex((s) => s.id === step);
  const currentIndex = getStepIndex(currentStep);

  return (
    <div className="flex items-center rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
      {steps.map((step, idx) => {
        const isCompleted = idx < currentIndex;
        const isCurrent = step.id === currentStep;

        return (
          <div key={step.id} className="flex items-center">
            <div
              className={cn(
                'flex items-center gap-2 rounded-md px-4 py-1.5 text-xs font-medium transition-all',
                isCurrent &&
                  'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white',
                !isCurrent && 'text-zinc-500 dark:text-zinc-400',
              )}
            >
              <span
                className={cn(
                  'flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold',
                  isCompleted && 'bg-green-500 text-white',
                  isCurrent &&
                    'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900',
                  !isCompleted &&
                    !isCurrent &&
                    'border border-zinc-300 dark:border-zinc-600',
                )}
              >
                {isCompleted ? <Check className="h-2.5 w-2.5" /> : step.number}
              </span>
              {step.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Horizontal Progress Stepper for Steps 2 & 3
function ProgressStepper({ currentStep }: { currentStep: Step }) {
  const steps = [
    { id: 'premise', label: 'Premise & Bible' },
    { id: 'assets', label: 'Assets' },
    { id: 'generate', label: 'Generate' },
  ];

  const getStepIndex = (step: Step) => steps.findIndex((s) => s.id === step);
  const currentIndex = getStepIndex(currentStep);

  return (
    <div className="mx-auto flex w-full max-w-2xl items-center justify-center py-6">
      {steps.map((step, idx) => {
        const isCompleted = idx < currentIndex;
        const isCurrent = step.id === currentStep;

        return (
          <div
            key={step.id}
            className="flex flex-1 items-center last:flex-initial"
          >
            <div className="relative flex flex-col items-center">
              <div
                className={cn(
                  'z-10 flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-transform',
                  isCompleted && 'bg-green-500 text-white',
                  isCurrent &&
                    'scale-110 bg-zinc-900 text-white shadow-md ring-4 ring-zinc-900/20 dark:bg-white dark:text-zinc-900 dark:ring-white/20',
                  !isCompleted &&
                    !isCurrent &&
                    'bg-zinc-200 text-zinc-500 dark:bg-zinc-700',
                )}
              >
                {isCompleted ? <Check className="h-3.5 w-3.5" /> : idx + 1}
              </div>
              <span
                className={cn(
                  'absolute -bottom-6 mt-2 text-xs font-medium whitespace-nowrap',
                  isCurrent && 'font-bold text-zinc-900 dark:text-white',
                  isCompleted && 'text-green-600 dark:text-green-400',
                  !isCompleted && !isCurrent && 'text-zinc-500',
                )}
              >
                {step.label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div
                className={cn(
                  'mx-2 -mt-4 h-0.5 flex-1 rounded',
                  idx < currentIndex
                    ? 'bg-green-500'
                    : 'bg-zinc-200 dark:bg-zinc-700',
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function SeasonGeneratorDialog({
  projectId,
}: SeasonGeneratorDialogProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('premise');
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Analysis State
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [seasonName, setSeasonName] = useState('');
  const [premise, setPremise] = useState('');
  const [showPremise, setShowPremise] = useState(false);
  const [showMarkdownPreview, setShowMarkdownPreview] = useState(false);

  // Mapping State: Name -> AssetID (or 'NEW')
  const [charMapping, setCharMapping] = useState<Record<string, string>>({});
  const [locMapping, setLocMapping] = useState<Record<string, string>>({});

  // WebSocket for async LLM results (uses shared provider from layout)
  const {
    status: llmStatus,
    result: llmResult,
    error: llmError,
    trigger: triggerLlm,
    reset: resetLlm,
  } = useLlmJob<{ data: AnalysisResult }>('season-analysis');

  const {
    assets: existingCharacters,
    fetchAssets: fetchCharacters,
    isLoading: _isLoadingChars,
  } = useAssets({
    projectId,
    type: 'character',
    limit: 100,
  });

  const {
    assets: existingLocations,
    fetchAssets: fetchLocations,
    isLoading: _isLoadingLocs,
  } = useAssets({
    projectId,
    type: 'location',
    limit: 100,
  });

  // Fetch assets when dialog opens
  // Note: Only depend on 'open' to avoid re-running when callbacks change
  useEffect(() => {
    if (open) {
      fetchCharacters();
      fetchLocations();
      resetLlm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // FILM-1143: Fetch project metadata for content-type awareness
  const [contentType, _setContentType] = useState<string | null>(null);
  const [researchCounts, setResearchCounts] = useState({
    sources: 0,
    facts: 0,
    apiSources: 0,
  });

  // Track verified facts for passing to analysis
  const [verifiedFacts, setVerifiedFacts] = useState<
    Array<{
      claim: string;
      source_citation: string | null;
      category: string | null;
    }>
  >([]);
  const [isRefreshingResearch, setIsRefreshingResearch] = useState(false);

  // Get route params for building the Research Hub link
  const params = useParams<{ account: string; projectSlug: string }>();

  // Shared fetch logic for research counts + verified facts (m1 fix: eliminate duplication)
  const fetchResearchData = useCallback(async () => {
    const [counts, facts] = await Promise.all([
      getResearchCountsAction({ projectId }),
      getVerifiedFactsAction({ projectId, limit: 50 }),
    ]);
    if (counts && typeof counts === 'object' && 'sources' in counts) {
      const c = counts as {
        sources: number;
        facts: number;
        apiSources: number;
      };
      setResearchCounts(c);
    }
    if (Array.isArray(facts)) {
      setVerifiedFacts(
        facts.map(
          (f: {
            claim?: string;
            source_citation?: string | null;
            category?: string | null;
          }) => ({
            claim: f.claim ?? '',
            source_citation: f.source_citation ?? null,
            category: f.category ?? null,
          }),
        ),
      );
    }
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    fetchResearchData().catch(() => {
      /* Non-critical */
    });
  }, [open, projectId, fetchResearchData]);

  const _isFactualContent =
    contentType === 'documentary' ||
    contentType === 'educational' ||
    contentType === 'news';
  const hasResearchSources =
    researchCounts.sources > 0 || researchCounts.facts > 0;

  // Process analysis result (reusable for both sync and async)
  const processAnalysisResult = useCallback(
    (data: AnalysisResult) => {
      // Post-process: Aggregate all unique locations from episodes into main list
      const globalLocations = data.locations || [];
      const globalLocationNames = new Set(
        globalLocations.map((l) => l.name.toLowerCase()),
      );

      const episodeLocationNames = new Set<string>();
      data.episodes.forEach((ep) => {
        ep.location_names?.forEach((name) => {
          if (!globalLocationNames.has(name.toLowerCase())) {
            episodeLocationNames.add(name);
          }
        });
      });

      const allLocations = [
        ...globalLocations,
        ...Array.from(episodeLocationNames).map((name) => ({
          name,
          description: `Location mentioned in episodes`,
          setting: 'general',
        })),
      ];

      const globalCharacters = data.characters || [];
      const globalCharNames = new Set(
        globalCharacters.map((c) => c.name.toLowerCase()),
      );

      const episodeCharNames = new Set<string>();
      data.episodes.forEach((ep) => {
        ep.character_names?.forEach((name) => {
          if (!globalCharNames.has(name.toLowerCase())) {
            episodeCharNames.add(name);
          }
        });
      });

      const allCharacters = [
        ...globalCharacters,
        ...Array.from(episodeCharNames).map((name) => ({
          name,
          role: 'supporting',
          description: `Character mentioned in episodes`,
        })),
      ];

      const enrichedAnalysis = {
        ...data,
        characters: allCharacters,
        locations: allLocations,
      };

      setAnalysis(enrichedAnalysis);
      setPremise(enrichedAnalysis.premise);
      setShowPremise(true);

      // Auto-map Characters
      const initialCharMapping: Record<string, string> = {};
      enrichedAnalysis.characters.forEach((c) => {
        const match = existingCharacters.find(
          (ex) => ex.name.toLowerCase() === c.name.toLowerCase(),
        );
        initialCharMapping[c.name] = match ? match.id : 'NEW';
      });
      setCharMapping(initialCharMapping);

      // Auto-map Locations
      const initialLocMapping: Record<string, string> = {};
      enrichedAnalysis.locations?.forEach((l) => {
        const match = existingLocations.find(
          (ex) => ex.name.toLowerCase() === l.name.toLowerCase(),
        );
        initialLocMapping[l.name] = match ? match.id : 'NEW';
      });
      setLocMapping(initialLocMapping);

      toast.success('Roadmap analyzed successfully!');
    },
    [existingCharacters, existingLocations],
  );

  // Handle async WebSocket result
  // Track processed result to avoid re-processing when processAnalysisResult reference changes
  const processedResultRef = useRef<unknown>(null);

  useEffect(() => {
    if (llmStatus === 'success' && llmResult) {
      // Skip if we already processed this result
      if (processedResultRef.current === llmResult) {
        return;
      }

      // llmResult is already the result object from message.result
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultData = (llmResult as any)?.data;
      if (resultData) {
        processedResultRef.current = llmResult;
        processAnalysisResult(resultData);
      }
    } else if (llmStatus === 'error') {
      toast.error(llmError || 'Analysis failed');
    }
  }, [llmStatus, llmResult, llmError, processAnalysisResult]);

  const form = useForm({
    resolver: zodResolver(AnalyzeSeasonSchema),
    defaultValues: {
      projectId,
      roadmap: '',
    },
  });

  const handleAnalyze = (data: { projectId: string; roadmap: string }) => {
    // Use the LLM job hook to trigger and await WebSocket result
    triggerLlm(async () => {
      // Include external facts for context
      const enrichedData = {
        ...data,
        externalFacts: verifiedFacts.length > 0 ? verifiedFacts : undefined,
      };
      const result = await analyzeSeasonRoadmapAction(enrichedData);
      // Job is always queued to Lambda - WebSocket will deliver result
      if (result?.success && result?.queued) {
        toast.info(
          'Analyzing roadmap in background... This may take 2-3 minutes.',
        );
        return { queued: true };
      }
      throw new Error('Failed to analyze roadmap');
    });
  };

  const handleGenerate = () => {
    if (!analysis) return;

    startTransition(async () => {
      try {
        const charactersToCreate = analysis.characters
          .filter((c) => charMapping[c.name] === 'NEW')
          .map((c) => ({
            name: c.name,
            description: c.description,
            role: c.role,
            physicalDescription: c.physicalDescription,
            clothingStyle: c.clothingStyle,
            mannerisms: c.mannerisms,
          }));

        const locationsToCreate = analysis.locations
          .filter((l) => locMapping[l.name] === 'NEW')
          .map((l) => ({
            name: l.name,
            description: l.description,
            setting: l.setting,
            visualDescription: l.visualDescription,
            timeOfDay: l.timeOfDay,
            weather: l.weather,
          }));

        const charMappingBackend: Record<string, string> = {};
        Object.entries(charMapping).forEach(([name, id]) => {
          if (id !== 'NEW') charMappingBackend[name] = id;
        });

        const locMappingBackend: Record<string, string> = {};
        Object.entries(locMapping).forEach(([name, id]) => {
          if (id !== 'NEW') locMappingBackend[name] = id;
        });

        const payload = {
          projectId,
          seasonName: seasonName.trim() || undefined,
          premise,
          tone: analysis.tone ?? undefined,
          targetAudience: analysis.target_audience ?? undefined,
          charactersToCreate,
          locationsToCreate,
          characterMappings: charMappingBackend,
          locationMappings: locMappingBackend,
          episodes: analysis.episodes.map((e) => ({
            number: e.number,
            title: e.title,
            synopsis: e.synopsis,
            beats: e.beats || [],
            moral: e.moral,
            signature_line: e.signature_line,
            characterNames: e.character_names,
            locationNames: e.location_names,
            tags: e.tags,
            // Legacy fallback
            description: e.description || e.synopsis,
          })),
        };

        const result = await generateSeasonEpisodesAction(payload);

        if (result?.success) {
          toast.success(`Generated ${result.count} episodes`);
          setOpen(false);
          setTimeout(() => {
            setStep('premise');
            form.reset();
            setAnalysis(null);
            setShowPremise(false);
            setSeasonName('');
          }, 500);
        } else {
          console.error(
            '[SeasonGenerator] Action returned non-success:',
            result,
          );

          const errorMsg = String(
            (result as Record<string, unknown>)?.error ??
              'Failed to generate season',
          );
          toast.error(errorMsg);
        }
      } catch (err) {
        console.error('[SeasonGenerator] Generation failed:', err);
        const message = refusalMessage(err, 'Unknown error');
        toast.error(`Failed to generate season: ${message}`);
      }
    });
  };

  const handleFileUpload = async (file: File) => {
    const text = await file.text();
    form.setValue('roadmap', text);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          <Plus className="mr-2 h-4 w-4" />
          Generate Season
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[85vh] flex-col overflow-hidden border-zinc-200 bg-white p-0 sm:max-w-5xl dark:border-zinc-800 dark:bg-zinc-900">
        <DialogTitle className="sr-only">Generate Season</DialogTitle>
        {/* Header */}
        <div className="flex h-16 items-center justify-between border-b border-zinc-200 bg-white/80 px-6 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900/80">
          <div className="w-40">
            <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-white">
              Generate Season
            </h2>
          </div>
          <div className="flex flex-1 justify-center">
            <StepIndicator currentStep={step} />
          </div>
          <div className="w-40" />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto bg-zinc-50/50 dark:bg-zinc-900/50">
          {/* Step 1: Premise */}
          {step === 'premise' && (
            <div className="mx-auto max-w-4xl space-y-8 p-8">
              {/* Season Name */}
              <section className="space-y-2">
                <label className="text-sm font-semibold text-zinc-900 dark:text-white">
                  Season Name
                </label>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Organize episodes by content type
                </p>
                <Input
                  value={seasonName}
                  onChange={(e) => setSeasonName(e.target.value)}
                  placeholder="e.g., History Deep Dives, Science Reels, Season 3"
                  className="max-w-md"
                />
              </section>

              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
                    <Sparkles className="h-4 w-4 text-purple-500" />
                    Production Roadmap / Series Bible
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setShowMarkdownPreview(!showMarkdownPreview)
                      }
                      className={cn(
                        'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                        showMarkdownPreview
                          ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                          : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700',
                      )}
                    >
                      {showMarkdownPreview ? (
                        <>
                          <Pencil className="h-3 w-3" />
                          Edit
                        </>
                      ) : (
                        <>
                          <Eye className="h-3 w-3" />
                          Preview
                        </>
                      )}
                    </button>
                    <span className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-500 shadow-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
                      Markdown & PDF Supported
                    </span>
                  </div>
                </div>

                <Form {...form}>
                  <form
                    id="analyze-form"
                    onSubmit={form.handleSubmit(handleAnalyze)}
                  >
                    <div className="grid h-64 grid-cols-1 gap-6 lg:grid-cols-12">
                      <div className="relative h-full lg:col-span-8">
                        <FormField
                          control={form.control}
                          name="roadmap"
                          render={({ field }) => (
                            <FormItem className="h-full">
                              <FormControl>
                                {showMarkdownPreview ? (
                                  <div className="prose prose-sm dark:prose-invert prose-headings:text-zinc-900 dark:prose-headings:text-white prose-p:text-zinc-600 dark:prose-p:text-zinc-300 prose-strong:text-zinc-900 dark:prose-strong:text-white prose-hr:border-zinc-200 dark:prose-hr:border-zinc-700 h-full w-full max-w-none overflow-y-auto rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-800">
                                    {field.value ? (
                                      <ReactMarkdown>
                                        {field.value}
                                      </ReactMarkdown>
                                    ) : (
                                      <p className="text-zinc-400 italic">
                                        No content to preview. Switch to edit
                                        mode to add content.
                                      </p>
                                    )}
                                  </div>
                                ) : (
                                  <Textarea
                                    placeholder={`# Detective Dante & Cece
## Season 1 Production Roadmap
---
## 📋 Series Overview
**Title:** Detective Dante & Cece
**Format:** Animated children's series
**Target Age:** 3+ years (with parent appeal)
**Total Runtime:** 210 minutes (3.5 hours)`}
                                    className="h-full w-full resize-none rounded-xl border border-zinc-200 bg-white p-5 font-mono text-sm leading-relaxed focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 dark:border-zinc-700 dark:bg-zinc-800"
                                    {...field}
                                  />
                                )}
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="h-full lg:col-span-4">
                        <div
                          className="group flex h-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-zinc-300 bg-zinc-50 p-6 text-center transition-all hover:border-purple-400 hover:bg-white hover:shadow-md dark:border-zinc-700 dark:bg-zinc-800/50 dark:hover:bg-zinc-800"
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={handleDrop}
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept=".txt,.md,.pdf,.docx"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleFileUpload(file);
                            }}
                          />
                          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm transition-transform group-hover:scale-110 dark:bg-zinc-700">
                            <Cloud className="h-6 w-6 text-purple-500" />
                          </div>
                          <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                            Drop files here
                          </p>
                          <p className="mt-1 text-xs text-zinc-400">
                            PDF, DOCX, TXT
                          </p>
                          <span className="mt-4 border-b border-purple-200 pb-0.5 text-xs font-medium text-purple-600 hover:border-purple-500 dark:border-purple-800 dark:text-purple-400">
                            Browse Computer
                          </span>
                        </div>
                      </div>
                    </div>
                  </form>
                </Form>
              </section>

              {/* FILM-1143: Research Sources Summary */}
              <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-800">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-blue-500" />
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
                      Research Sources
                    </h3>
                  </div>
                  <div className="flex items-center gap-2">
                    {hasResearchSources && (
                      <>
                        <Badge variant="outline" className="text-xs">
                          {researchCounts.sources} source
                          {researchCounts.sources !== 1 ? 's' : ''}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {researchCounts.facts} fact
                          {researchCounts.facts !== 1 ? 's' : ''}
                        </Badge>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={isRefreshingResearch}
                      onClick={async () => {
                        setIsRefreshingResearch(true);
                        try {
                          await fetchResearchData();
                          toast.success('Research data refreshed');
                        } catch {
                          toast.error('Failed to refresh research data');
                        } finally {
                          setIsRefreshingResearch(false);
                        }
                      }}
                    >
                      <RefreshCw
                        className={cn(
                          'h-3.5 w-3.5',
                          isRefreshingResearch && 'animate-spin',
                        )}
                      />
                    </Button>
                  </div>
                </div>

                {/* News API connection status */}
                {contentType === 'news' && (
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <div
                      className={cn(
                        'h-2 w-2 rounded-full',
                        researchCounts.apiSources > 0
                          ? 'bg-green-500'
                          : 'bg-zinc-300 dark:bg-zinc-600',
                      )}
                    />
                    <span className="text-muted-foreground">
                      API Sources:{' '}
                      {researchCounts.apiSources > 0
                        ? `${researchCounts.apiSources} connected`
                        : 'Not configured'}
                    </span>
                  </div>
                )}

                {!hasResearchSources ? (
                  <div className="mt-3 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800/50 dark:bg-amber-900/10">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
                    <div>
                      <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                        No research sources linked
                      </p>
                      <p className="mt-0.5 text-xs text-amber-700/80 dark:text-amber-400/80">
                        Add external sources and verified facts in the Research
                        Hub to improve factual accuracy of generated content.
                      </p>
                      {params?.account && params?.projectSlug && (
                        <Link
                          href={`/home/${params.account}/studio/${params.projectSlug}/research`}
                          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-amber-700 underline hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-300"
                        >
                          <BookOpen className="h-3 w-3" />
                          Add Sources
                        </Link>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Verified facts from your research will be considered during
                    generation.
                  </p>
                )}
              </section>

              {/* Analyze Button */}
              <div className="flex items-center gap-4 py-2">
                <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
                <Button
                  type="submit"
                  form="analyze-form"
                  disabled={
                    isPending ||
                    llmStatus === 'pending' ||
                    !form.watch('roadmap')
                  }
                  className="relative flex items-center gap-2 rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-semibold text-white shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl dark:bg-white dark:text-zinc-900"
                >
                  {isPending || llmStatus === 'pending' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {llmStatus === 'pending'
                    ? 'Analyzing...'
                    : 'Analyze & Generate Premise'}
                </Button>
                <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
              </div>

              {/* Season Premise Section */}
              {showPremise && analysis && (
                <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
                  <button
                    onClick={() => setShowPremise(!showPremise)}
                    className="flex w-full cursor-pointer items-center justify-between border-b border-zinc-100 bg-zinc-50/50 px-5 py-4 dark:border-zinc-700 dark:bg-zinc-800/50"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                        <Sparkles className="h-4 w-4" />
                      </div>
                      <div className="text-left">
                        <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
                          Season Premise
                        </h3>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          Generated from Roadmap • 2 Alternatives available
                        </p>
                      </div>
                    </div>
                    <ChevronDown className="h-5 w-5 text-zinc-400" />
                  </button>
                  <div className="p-6">
                    <div
                      contentEditable
                      suppressContentEditableWarning
                      className="prose prose-sm max-w-none leading-relaxed text-zinc-600 outline-none focus:ring-0 dark:text-zinc-300"
                      onBlur={(e) =>
                        setPremise(e.currentTarget.textContent || '')
                      }
                    >
                      <p className="mb-3">
                        <strong className="text-zinc-900 dark:text-white">
                          Logline:
                        </strong>{' '}
                        {premise}
                      </p>
                    </div>
                    <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-zinc-100 pt-4 dark:border-zinc-700">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium tracking-wider text-zinc-400 uppercase">
                          AI Alternatives
                        </span>
                        <div className="flex gap-2">
                          <button className="rounded-full border border-transparent bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:border-blue-800 dark:hover:bg-blue-900/20 dark:hover:text-blue-400">
                            Focus on Adventure
                          </button>
                          <button className="rounded-full border border-transparent bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:border-blue-800 dark:hover:bg-blue-900/20 dark:hover:text-blue-400">
                            More Educational
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-zinc-400">
                        <Pencil className="h-3 w-3" />
                        Click text to edit inline
                      </div>
                    </div>
                  </div>
                </section>
              )}
            </div>
          )}

          {/* Step 2: Assets */}
          {step === 'assets' && analysis && (
            <div className="p-8">
              <ProgressStepper currentStep={step} />
              <div className="h-8" />
              <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
                {/* Characters */}
                <div className="flex flex-col gap-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-base font-bold text-zinc-900 dark:text-white">
                      <span className="flex h-6 w-6 items-center justify-center rounded bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400">
                        <Users className="h-3.5 w-3.5" />
                      </span>
                      Characters
                      <span className="ml-1 text-xs font-normal text-zinc-500">
                        ({analysis.characters.length} identified)
                      </span>
                    </h3>
                    <Button variant="outline" size="sm" className="h-7 text-xs">
                      <Plus className="mr-1 h-3 w-3" /> Add
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {analysis.characters.map((char, idx) => {
                      const isExisting = charMapping[char.name] !== 'NEW';
                      const _linkedAsset = existingCharacters.find(
                        (c) => c.id === charMapping[char.name],
                      );
                      return (
                        <div
                          key={idx}
                          className={cn(
                            'group relative rounded-xl border bg-white p-3 shadow-sm transition-all dark:bg-zinc-800',
                            isExisting
                              ? 'border-green-200 dark:border-green-900/40'
                              : 'border-blue-200 ring-1 ring-blue-50 dark:border-blue-900/40 dark:ring-blue-900/10',
                          )}
                        >
                          <div className="flex items-start gap-3">
                            <div
                              className={cn(
                                'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg',
                                isExisting
                                  ? 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400'
                                  : 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400',
                              )}
                            >
                              <Users className="h-5 w-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <h4 className="truncate text-sm font-semibold text-zinc-900 dark:text-white">
                                  {char.name}
                                </h4>
                                <Badge
                                  variant={isExisting ? 'secondary' : 'outline'}
                                  className={cn(
                                    'flex-shrink-0 text-[10px]',
                                    isExisting
                                      ? 'border-green-100 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/30 dark:text-green-300'
                                      : 'border-blue-100 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
                                  )}
                                >
                                  {isExisting ? 'Linked' : 'New'}
                                </Badge>
                              </div>
                              <p className="mt-0.5 line-clamp-1 text-xs text-zinc-500 dark:text-zinc-400">
                                {char.description}
                              </p>
                              {/* Linking Dropdown */}
                              <div className="mt-2">
                                <Select
                                  value={charMapping[char.name] || 'NEW'}
                                  onValueChange={(value) => {
                                    setCharMapping((prev) => ({
                                      ...prev,
                                      [char.name]: value,
                                    }));
                                  }}
                                >
                                  <SelectTrigger className="h-7 text-xs">
                                    <SelectValue placeholder="Link to existing..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="NEW">
                                      <span className="flex items-center gap-2">
                                        <Plus className="h-3 w-3" />
                                        Create New Character
                                      </span>
                                    </SelectItem>
                                    {existingCharacters.map((existing) => (
                                      <SelectItem
                                        key={existing.id}
                                        value={existing.id}
                                      >
                                        {existing.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Locations */}
                <div className="flex flex-col gap-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-base font-bold text-zinc-900 dark:text-white">
                      <span className="flex h-6 w-6 items-center justify-center rounded bg-teal-100 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400">
                        <MapPin className="h-3.5 w-3.5" />
                      </span>
                      Locations
                      <span className="ml-1 text-xs font-normal text-zinc-500">
                        ({analysis.locations?.length || 0} identified)
                      </span>
                    </h3>
                    <Button variant="outline" size="sm" className="h-7 text-xs">
                      <Plus className="mr-1 h-3 w-3" /> Add
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {analysis.locations?.map((loc, idx) => {
                      const isExisting = locMapping[loc.name] !== 'NEW';
                      const _linkedAsset = existingLocations.find(
                        (l) => l.id === locMapping[loc.name],
                      );
                      return (
                        <div
                          key={idx}
                          className={cn(
                            'group relative rounded-xl border bg-white p-3 shadow-sm transition-all dark:bg-zinc-800',
                            isExisting
                              ? 'border-green-200 dark:border-green-900/40'
                              : 'border-teal-200 ring-1 ring-teal-50 dark:border-teal-900/40 dark:ring-teal-900/10',
                          )}
                        >
                          <div className="flex items-start gap-3">
                            <div
                              className={cn(
                                'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg',
                                isExisting
                                  ? 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400'
                                  : 'bg-teal-50 text-teal-600 dark:bg-teal-900/20 dark:text-teal-400',
                              )}
                            >
                              <MapPin className="h-5 w-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <h4 className="truncate text-sm font-semibold text-zinc-900 dark:text-white">
                                  {loc.name}
                                </h4>
                                <Badge
                                  variant={isExisting ? 'secondary' : 'outline'}
                                  className={cn(
                                    'flex-shrink-0 text-[10px]',
                                    isExisting
                                      ? 'border-green-100 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/30 dark:text-green-300'
                                      : 'border-teal-100 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-900/30 dark:text-teal-300',
                                  )}
                                >
                                  {isExisting ? 'Linked' : 'New'}
                                </Badge>
                              </div>
                              <p className="mt-0.5 line-clamp-1 text-xs text-zinc-500 dark:text-zinc-400">
                                {loc.description}
                              </p>
                              {/* Linking Dropdown */}
                              <div className="mt-2">
                                <Select
                                  value={locMapping[loc.name] || 'NEW'}
                                  onValueChange={(value) => {
                                    setLocMapping((prev) => ({
                                      ...prev,
                                      [loc.name]: value,
                                    }));
                                  }}
                                >
                                  <SelectTrigger className="h-7 text-xs">
                                    <SelectValue placeholder="Link to existing..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="NEW">
                                      <span className="flex items-center gap-2">
                                        <Plus className="h-3 w-3" />
                                        Create New Location
                                      </span>
                                    </SelectItem>
                                    {existingLocations.map((existing) => (
                                      <SelectItem
                                        key={existing.id}
                                        value={existing.id}
                                      >
                                        {existing.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Generate */}
          {step === 'generate' && analysis && (
            <div className="p-8">
              <ProgressStepper currentStep={step} />
              <div className="h-8" />
              <div className="mb-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200">
                    Proposed Episodes
                  </h3>
                  <span className="rounded-full bg-zinc-200 px-2.5 py-0.5 text-xs font-semibold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                    {analysis.episodes.length}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-zinc-500"
                >
                  Sort by
                </Button>
              </div>
              <div className="space-y-4">
                {analysis.episodes.map((ep) => (
                  <div
                    key={ep.number}
                    className="group relative cursor-default rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition-all hover:border-blue-300 hover:shadow-md dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-blue-700"
                  >
                    <div className="flex items-start gap-5">
                      <div className="w-8 flex-shrink-0 pt-1 text-center">
                        <span className="font-mono text-sm font-bold text-zinc-400">
                          {String(ep.number).padStart(2, '0')}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="mb-1 text-base font-semibold text-zinc-900 transition-colors group-hover:text-blue-600 dark:text-white dark:group-hover:text-blue-400">
                          {ep.title}
                        </h4>
                        <p className="mb-3 line-clamp-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                          {ep.synopsis ||
                            ep.description ||
                            'No description available'}
                        </p>

                        {/* Plot Beats */}
                        {ep.beats && ep.beats.length > 0 && (
                          <div className="mb-3 rounded-lg border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/50">
                            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                              <ListChecks className="h-3.5 w-3.5" />
                              Plot Structure
                            </div>
                            <div className="space-y-1.5">
                              {ep.beats.map((beat, idx) => (
                                <div
                                  key={idx}
                                  className="flex items-start gap-2 text-xs"
                                >
                                  <ChevronRight className="mt-0.5 h-3 w-3 flex-shrink-0 text-zinc-400" />
                                  <span className="font-medium text-zinc-700 dark:text-zinc-300">
                                    {beat.label}:
                                  </span>
                                  <span className="text-zinc-500 dark:text-zinc-400">
                                    {beat.content.length > 80
                                      ? beat.content.slice(0, 80) + '...'
                                      : beat.content}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Moral & Signature Line */}
                        <div className="mb-3 flex flex-wrap gap-2">
                          {ep.moral && (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-pink-100 bg-pink-50 px-2.5 py-1 text-[11px] font-medium text-pink-700 dark:border-pink-900 dark:bg-pink-900/20 dark:text-pink-300">
                              <Heart className="h-3 w-3" />
                              {ep.moral}
                            </span>
                          )}
                          {ep.signature_line && (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-100 bg-purple-50 px-2.5 py-1 text-[11px] font-medium text-purple-700 dark:border-purple-900 dark:bg-purple-900/20 dark:text-purple-300">
                              <MessageCircle className="h-3 w-3" />
                              &quot;
                              {ep.signature_line.length > 40
                                ? ep.signature_line.slice(0, 40) + '...'
                                : ep.signature_line}
                              &quot;
                            </span>
                          )}
                        </div>

                        {/* Characters & Locations */}
                        <div className="flex flex-wrap items-center gap-2">
                          {ep.character_names?.map((name) => (
                            <span
                              key={name}
                              className="inline-flex items-center rounded-md border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                            >
                              <Users className="mr-1 h-3 w-3 opacity-60" />
                              {name}
                            </span>
                          ))}
                          {ep.location_names?.map((name) => (
                            <span
                              key={name}
                              className="inline-flex items-center rounded-md border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                            >
                              <MapPin className="mr-1 h-3 w-3 opacity-60" />
                              {name}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-200 bg-white px-8 py-5 dark:border-zinc-800 dark:bg-zinc-900">
          {step === 'premise' ? (
            <div />
          ) : (
            <Button
              variant="ghost"
              onClick={() => setStep(step === 'assets' ? 'premise' : 'assets')}
              disabled={isPending}
              className="text-zinc-500"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          )}
          <div className="flex items-center gap-3">
            <Button variant="ghost" className="text-zinc-500">
              Save as Draft
            </Button>
            {step === 'premise' && (
              <Button
                onClick={() => setStep('assets')}
                disabled={!analysis || isPending}
                className="bg-zinc-900 text-white shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl dark:bg-white dark:text-zinc-900"
              >
                Next: Review Details
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
            {step === 'assets' && (
              <Button
                onClick={() => setStep('generate')}
                disabled={isPending}
                className="bg-zinc-900 text-white shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl dark:bg-white dark:text-zinc-900"
              >
                Next: Generate Episodes
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
            {step === 'generate' && (
              <div className="flex items-center gap-4">
                <div className="hidden items-center rounded-full border border-zinc-100 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-400 sm:flex dark:border-zinc-700/50 dark:bg-zinc-800/50">
                  <Timer className="mr-1.5 h-3.5 w-3.5 text-blue-500" />
                  Est. generation time: ~2 mins
                </div>
                <Button
                  onClick={handleGenerate}
                  disabled={isPending}
                  className="bg-zinc-900 text-white shadow-lg transition-all hover:shadow-xl dark:bg-white dark:text-zinc-900"
                >
                  {isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Confirm & Generate
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
