'use client';

import { useState, useTransition, useRef, useEffect } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, ArrowRight, Check, ChevronDown, Cloud, Eye, Loader2, MapPin, Pencil, Plus, Sparkles, Timer, Users } from 'lucide-react';
import { useForm } from 'react-hook-form';
import ReactMarkdown from 'react-markdown';
import { toast } from '@kit/ui/sonner';

import { useAssets } from '@kit/assets/hooks';
import { AnalyzeSeasonSchema } from '@kit/episodes/schemas';
import { analyzeSeasonRoadmapAction, generateSeasonEpisodesAction } from '@kit/episodes/server/season-generation';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogTrigger,
} from '@kit/ui/dialog';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
} from '@kit/ui/form';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@kit/ui/select';
import { Textarea } from '@kit/ui/textarea';
import { cn } from '@kit/ui/utils';

interface SeasonGeneratorDialogProps {
    projectId: string;
}

type Step = 'premise' | 'assets' | 'generate';

interface AnalysisResult {
    premise: string;
    characters: Array<{ name: string; role: string; description: string }>;
    locations: Array<{ name: string; setting: string; description: string }>;
    episodes: Array<{ number: number; title: string; description: string; character_names: string[]; location_names: string[] }>;
}

// Step Indicator Component
function StepIndicator({ currentStep }: { currentStep: Step }) {
    const steps = [
        { id: 'premise', label: 'Premise', number: 1 },
        { id: 'assets', label: 'Assets', number: 2 },
        { id: 'generate', label: 'Generate', number: 3 },
    ];

    const getStepIndex = (step: Step) => steps.findIndex(s => s.id === step);
    const currentIndex = getStepIndex(currentStep);

    return (
        <div className="flex items-center bg-zinc-100 dark:bg-zinc-800 p-1 rounded-lg">
            {steps.map((step, idx) => {
                const isCompleted = idx < currentIndex;
                const isCurrent = step.id === currentStep;

                return (
                    <div key={step.id} className="flex items-center">
                        <div className={cn(
                            "px-4 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-all",
                            isCurrent && "bg-white dark:bg-zinc-700 shadow-sm text-zinc-900 dark:text-white",
                            !isCurrent && "text-zinc-500 dark:text-zinc-400"
                        )}>
                            <span className={cn(
                                "flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold",
                                isCompleted && "bg-green-500 text-white",
                                isCurrent && "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900",
                                !isCompleted && !isCurrent && "border border-zinc-300 dark:border-zinc-600"
                            )}>
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

    const getStepIndex = (step: Step) => steps.findIndex(s => s.id === step);
    const currentIndex = getStepIndex(currentStep);

    return (
        <div className="flex items-center justify-center w-full max-w-2xl mx-auto py-6">
            {steps.map((step, idx) => {
                const isCompleted = idx < currentIndex;
                const isCurrent = step.id === currentStep;

                return (
                    <div key={step.id} className="flex items-center flex-1 last:flex-initial">
                        <div className="flex flex-col items-center relative">
                            <div className={cn(
                                "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold z-10 transition-transform",
                                isCompleted && "bg-green-500 text-white",
                                isCurrent && "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 ring-4 ring-zinc-900/20 dark:ring-white/20 shadow-md scale-110",
                                !isCompleted && !isCurrent && "bg-zinc-200 dark:bg-zinc-700 text-zinc-500"
                            )}>
                                {isCompleted ? <Check className="h-3.5 w-3.5" /> : idx + 1}
                            </div>
                            <span className={cn(
                                "text-xs font-medium mt-2 absolute -bottom-6 whitespace-nowrap",
                                isCurrent && "font-bold text-zinc-900 dark:text-white",
                                isCompleted && "text-green-600 dark:text-green-400",
                                !isCompleted && !isCurrent && "text-zinc-500"
                            )}>
                                {step.label}
                            </span>
                        </div>
                        {idx < steps.length - 1 && (
                            <div className={cn(
                                "flex-1 h-0.5 mx-2 -mt-4 rounded",
                                idx < currentIndex ? "bg-green-500" : "bg-zinc-200 dark:bg-zinc-700"
                            )} />
                        )}
                    </div>
                );
            })}
        </div>
    );
}

export function SeasonGeneratorDialog({ projectId }: SeasonGeneratorDialogProps) {
    const [open, setOpen] = useState(false);
    const [step, setStep] = useState<Step>('premise');
    const [isPending, startTransition] = useTransition();
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Analysis State
    const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
    const [premise, setPremise] = useState('');
    const [showPremise, setShowPremise] = useState(false);
    const [showMarkdownPreview, setShowMarkdownPreview] = useState(false);

    // Mapping State: Name -> AssetID (or 'NEW')
    const [charMapping, setCharMapping] = useState<Record<string, string>>({});
    const [locMapping, setLocMapping] = useState<Record<string, string>>({});

    const { assets: existingCharacters, fetchAssets: fetchCharacters, isLoading: _isLoadingChars } = useAssets({
        projectId,
        type: 'character',
        limit: 100,
    });

    const { assets: existingLocations, fetchAssets: fetchLocations, isLoading: _isLoadingLocs } = useAssets({
        projectId,
        type: 'location',
        limit: 100,
    });

    // Fetch assets when dialog opens
    useEffect(() => {
        if (open) {
            fetchCharacters();
            fetchLocations();
        }
    }, [open, fetchCharacters, fetchLocations]);

    const form = useForm({
        resolver: zodResolver(AnalyzeSeasonSchema),
        defaultValues: {
            projectId,
            roadmap: '',
        },
    });

    const handleAnalyze = (data: { projectId: string; roadmap: string }) => {
        startTransition(async () => {
            try {
                const result = await analyzeSeasonRoadmapAction(data);
                if (result?.data) {
                    setAnalysis(result.data);
                    setPremise(result.data.premise);
                    setShowPremise(true);

                    // Debug: log existing assets
                    console.log('Existing Characters:', existingCharacters);
                    console.log('Existing Locations:', existingLocations);
                    console.log('Extracted Characters:', result.data.characters);
                    console.log('Extracted Locations:', result.data.locations);

                    // Auto-map Characters
                    const initialCharMapping: Record<string, string> = {};
                    result.data.characters.forEach(c => {
                        const match = existingCharacters.find(ex => ex.name.toLowerCase() === c.name.toLowerCase());
                        initialCharMapping[c.name] = match ? match.id : 'NEW';
                        console.log(`Character "${c.name}" => ${match ? `LINKED to ${match.id}` : 'NEW'}`);
                    });
                    setCharMapping(initialCharMapping);

                    // Auto-map Locations
                    const initialLocMapping: Record<string, string> = {};
                    result.data.locations?.forEach(l => {
                        const match = existingLocations.find(ex => ex.name.toLowerCase() === l.name.toLowerCase());
                        initialLocMapping[l.name] = match ? match.id : 'NEW';
                        console.log(`Location "${l.name}" => ${match ? `LINKED to ${match.id}` : 'NEW'}`);
                    });
                    setLocMapping(initialLocMapping);
                } else {
                    toast.error('Failed to analyze roadmap');
                }
            } catch {
                toast.error('An error occurred during analysis');
            }
        });
    };

    const handleGenerate = () => {
        if (!analysis) return;

        startTransition(async () => {
            try {
                const charactersToCreate = analysis.characters
                    .filter(c => charMapping[c.name] === 'NEW')
                    .map(c => ({
                        name: c.name,
                        description: c.description,
                        role: c.role
                    }));

                const locationsToCreate = analysis.locations
                    .filter(l => locMapping[l.name] === 'NEW')
                    .map(l => ({
                        name: l.name,
                        description: l.description,
                        setting: l.setting
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
                    premise,
                    charactersToCreate,
                    locationsToCreate,
                    characterMappings: charMappingBackend,
                    locationMappings: locMappingBackend,
                    episodes: analysis.episodes.map(e => ({
                        number: e.number,
                        title: e.title,
                        description: e.description,
                        characterNames: e.character_names,
                        locationNames: e.location_names
                    }))
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
                    }, 500);
                } else {
                    toast.error('Failed to generate season');
                }
            } catch {
                toast.error('Failed to generate season');
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
                <Button variant="outline" className="border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                    <Plus className="mr-2 h-4 w-4" />
                    Generate Season
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-5xl h-[85vh] p-0 flex flex-col bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 overflow-hidden">
                <DialogTitle className="sr-only">Generate Season</DialogTitle>
                {/* Header */}
                <div className="flex items-center justify-between px-6 h-16 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md">
                    <div className="w-40">
                        <h2 className="text-sm font-semibold text-zinc-900 dark:text-white tracking-tight">Generate Season</h2>
                    </div>
                    <div className="flex-1 flex justify-center">
                        <StepIndicator currentStep={step} />
                    </div>
                    <div className="w-40" />
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto bg-zinc-50/50 dark:bg-zinc-900/50">
                    {/* Step 1: Premise */}
                    {step === 'premise' && (
                        <div className="max-w-4xl mx-auto p-8 space-y-8">
                            <section className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <label className="text-sm font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
                                        <Sparkles className="w-4 h-4 text-purple-500" />
                                        Production Roadmap / Series Bible
                                    </label>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setShowMarkdownPreview(!showMarkdownPreview)}
                                            className={cn(
                                                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                                                showMarkdownPreview
                                                    ? "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300"
                                                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                                            )}
                                        >
                                            {showMarkdownPreview ? (
                                                <>
                                                    <Pencil className="w-3 h-3" />
                                                    Edit
                                                </>
                                            ) : (
                                                <>
                                                    <Eye className="w-3 h-3" />
                                                    Preview
                                                </>
                                            )}
                                        </button>
                                        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 bg-white dark:bg-zinc-800 px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 shadow-sm">
                                            Markdown & PDF Supported
                                        </span>
                                    </div>
                                </div>

                                <Form {...form}>
                                    <form id="analyze-form" onSubmit={form.handleSubmit(handleAnalyze)}>
                                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-64">
                                            <div className="lg:col-span-8 relative h-full">
                                                <FormField
                                                    control={form.control}
                                                    name="roadmap"
                                                    render={({ field }) => (
                                                        <FormItem className="h-full">
                                                            <FormControl>
                                                                {showMarkdownPreview ? (
                                                                    <div className="w-full h-full p-5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl overflow-y-auto prose prose-sm dark:prose-invert max-w-none prose-headings:text-zinc-900 dark:prose-headings:text-white prose-p:text-zinc-600 dark:prose-p:text-zinc-300 prose-strong:text-zinc-900 dark:prose-strong:text-white prose-hr:border-zinc-200 dark:prose-hr:border-zinc-700">
                                                                        {field.value ? (
                                                                            <ReactMarkdown>{field.value}</ReactMarkdown>
                                                                        ) : (
                                                                            <p className="text-zinc-400 italic">No content to preview. Switch to edit mode to add content.</p>
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
                                                                        className="w-full h-full p-5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 font-mono text-sm leading-relaxed resize-none"
                                                                        {...field}
                                                                    />
                                                                )}
                                                            </FormControl>
                                                        </FormItem>
                                                    )}
                                                />
                                            </div>
                                            <div className="lg:col-span-4 h-full">
                                                <div
                                                    className="h-full border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-xl flex flex-col items-center justify-center p-6 text-center bg-zinc-50 dark:bg-zinc-800/50 hover:bg-white dark:hover:bg-zinc-800 hover:border-purple-400 hover:shadow-md transition-all cursor-pointer group"
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
                                                    <div className="w-12 h-12 rounded-full bg-white dark:bg-zinc-700 shadow-sm flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                                                        <Cloud className="w-6 h-6 text-purple-500" />
                                                    </div>
                                                    <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Drop files here</p>
                                                    <p className="text-xs text-zinc-400 mt-1">PDF, DOCX, TXT</p>
                                                    <span className="mt-4 text-xs font-medium text-purple-600 dark:text-purple-400 border-b border-purple-200 dark:border-purple-800 pb-0.5 hover:border-purple-500">
                                                        Browse Computer
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </form>
                                </Form>
                            </section>

                            {/* Analyze Button */}
                            <div className="flex items-center gap-4 py-2">
                                <div className="h-px bg-zinc-200 dark:bg-zinc-700 flex-1" />
                                <Button
                                    type="submit"
                                    form="analyze-form"
                                    disabled={isPending || !form.watch('roadmap')}
                                    className="relative flex items-center gap-2 px-6 py-2.5 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-full text-sm font-semibold shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all"
                                >
                                    {isPending ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <Sparkles className="w-4 h-4" />
                                    )}
                                    Analyze & Generate Premise
                                </Button>
                                <div className="h-px bg-zinc-200 dark:bg-zinc-700 flex-1" />
                            </div>

                            {/* Season Premise Section */}
                            {showPremise && analysis && (
                                <section className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-sm overflow-hidden">
                                    <button
                                        onClick={() => setShowPremise(!showPremise)}
                                        className="w-full px-5 py-4 flex items-center justify-between cursor-pointer border-b border-zinc-100 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-800/50"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
                                                <Sparkles className="w-4 h-4" />
                                            </div>
                                            <div className="text-left">
                                                <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">Season Premise</h3>
                                                <p className="text-xs text-zinc-500 dark:text-zinc-400">Generated from Roadmap • 2 Alternatives available</p>
                                            </div>
                                        </div>
                                        <ChevronDown className="w-5 h-5 text-zinc-400" />
                                    </button>
                                    <div className="p-6">
                                        <div
                                            contentEditable
                                            suppressContentEditableWarning
                                            className="prose prose-sm max-w-none text-zinc-600 dark:text-zinc-300 leading-relaxed outline-none focus:ring-0"
                                            onBlur={(e) => setPremise(e.currentTarget.textContent || '')}
                                        >
                                            <p className="mb-3"><strong className="text-zinc-900 dark:text-white">Logline:</strong> {premise}</p>
                                        </div>
                                        <div className="mt-6 pt-4 border-t border-zinc-100 dark:border-zinc-700 flex flex-wrap items-center justify-between gap-4">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">AI Alternatives</span>
                                                <div className="flex gap-2">
                                                    <button className="px-3 py-1.5 text-xs font-medium bg-zinc-100 dark:bg-zinc-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-600 dark:hover:text-blue-400 text-zinc-600 dark:text-zinc-300 rounded-full transition-colors border border-transparent hover:border-blue-200 dark:hover:border-blue-800">
                                                        Focus on Adventure
                                                    </button>
                                                    <button className="px-3 py-1.5 text-xs font-medium bg-zinc-100 dark:bg-zinc-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-600 dark:hover:text-blue-400 text-zinc-600 dark:text-zinc-300 rounded-full transition-colors border border-transparent hover:border-blue-200 dark:hover:border-blue-800">
                                                        More Educational
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 text-xs text-zinc-400">
                                                <Pencil className="w-3 h-3" />
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
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                {/* Characters */}
                                <div className="flex flex-col gap-4">
                                    <div className="flex items-center justify-between mb-2">
                                        <h3 className="text-base font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                                            <span className="w-6 h-6 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                                                <Users className="w-3.5 h-3.5" />
                                            </span>
                                            Characters
                                            <span className="ml-1 text-xs font-normal text-zinc-500">({analysis.characters.length} identified)</span>
                                        </h3>
                                        <Button variant="outline" size="sm" className="text-xs h-7">
                                            <Plus className="w-3 h-3 mr-1" /> Add
                                        </Button>
                                    </div>
                                    <div className="space-y-3">
                                        {analysis.characters.map((char, idx) => {
                                            const isExisting = charMapping[char.name] !== 'NEW';
                                            const _linkedAsset = existingCharacters.find(c => c.id === charMapping[char.name]);
                                            return (
                                                <div
                                                    key={idx}
                                                    className={cn(
                                                        "group relative bg-white dark:bg-zinc-800 p-3 rounded-xl border shadow-sm transition-all",
                                                        isExisting ? "border-green-200 dark:border-green-900/40" : "border-blue-200 dark:border-blue-900/40 ring-1 ring-blue-50 dark:ring-blue-900/10"
                                                    )}
                                                >
                                                    <div className="flex items-start gap-3">
                                                        <div className={cn(
                                                            "w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0",
                                                            isExisting ? "bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400" : "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                                                        )}>
                                                            <Users className="w-5 h-5" />
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center justify-between gap-2">
                                                                <h4 className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{char.name}</h4>
                                                                <Badge variant={isExisting ? "secondary" : "outline"} className={cn(
                                                                    "text-[10px] flex-shrink-0",
                                                                    isExisting
                                                                        ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300 border-green-100 dark:border-green-800"
                                                                        : "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border-blue-100 dark:border-blue-800"
                                                                )}>
                                                                    {isExisting ? 'Linked' : 'New'}
                                                                </Badge>
                                                            </div>
                                                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 line-clamp-1">
                                                                {char.description}
                                                            </p>
                                                            {/* Linking Dropdown */}
                                                            <div className="mt-2">
                                                                <Select
                                                                    value={charMapping[char.name] || 'NEW'}
                                                                    onValueChange={(value) => {
                                                                        setCharMapping(prev => ({ ...prev, [char.name]: value }));
                                                                    }}
                                                                >
                                                                    <SelectTrigger className="h-7 text-xs">
                                                                        <SelectValue placeholder="Link to existing..." />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        <SelectItem value="NEW">
                                                                            <span className="flex items-center gap-2">
                                                                                <Plus className="w-3 h-3" />
                                                                                Create New Character
                                                                            </span>
                                                                        </SelectItem>
                                                                        {existingCharacters.map(existing => (
                                                                            <SelectItem key={existing.id} value={existing.id}>
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
                                    <div className="flex items-center justify-between mb-2">
                                        <h3 className="text-base font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                                            <span className="w-6 h-6 rounded bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 flex items-center justify-center">
                                                <MapPin className="w-3.5 h-3.5" />
                                            </span>
                                            Locations
                                            <span className="ml-1 text-xs font-normal text-zinc-500">({analysis.locations?.length || 0} identified)</span>
                                        </h3>
                                        <Button variant="outline" size="sm" className="text-xs h-7">
                                            <Plus className="w-3 h-3 mr-1" /> Add
                                        </Button>
                                    </div>
                                    <div className="space-y-3">
                                        {analysis.locations?.map((loc, idx) => {
                                            const isExisting = locMapping[loc.name] !== 'NEW';
                                            const _linkedAsset = existingLocations.find(l => l.id === locMapping[loc.name]);
                                            return (
                                                <div
                                                    key={idx}
                                                    className={cn(
                                                        "group relative bg-white dark:bg-zinc-800 p-3 rounded-xl border shadow-sm transition-all",
                                                        isExisting ? "border-green-200 dark:border-green-900/40" : "border-teal-200 dark:border-teal-900/40 ring-1 ring-teal-50 dark:ring-teal-900/10"
                                                    )}
                                                >
                                                    <div className="flex items-start gap-3">
                                                        <div className={cn(
                                                            "w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0",
                                                            isExisting ? "bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400" : "bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400"
                                                        )}>
                                                            <MapPin className="w-5 h-5" />
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center justify-between gap-2">
                                                                <h4 className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{loc.name}</h4>
                                                                <Badge variant={isExisting ? "secondary" : "outline"} className={cn(
                                                                    "text-[10px] flex-shrink-0",
                                                                    isExisting
                                                                        ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300 border-green-100 dark:border-green-800"
                                                                        : "bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300 border-teal-100 dark:border-teal-800"
                                                                )}>
                                                                    {isExisting ? 'Linked' : 'New'}
                                                                </Badge>
                                                            </div>
                                                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 line-clamp-1">
                                                                {loc.description}
                                                            </p>
                                                            {/* Linking Dropdown */}
                                                            <div className="mt-2">
                                                                <Select
                                                                    value={locMapping[loc.name] || 'NEW'}
                                                                    onValueChange={(value) => {
                                                                        setLocMapping(prev => ({ ...prev, [loc.name]: value }));
                                                                    }}
                                                                >
                                                                    <SelectTrigger className="h-7 text-xs">
                                                                        <SelectValue placeholder="Link to existing..." />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        <SelectItem value="NEW">
                                                                            <span className="flex items-center gap-2">
                                                                                <Plus className="w-3 h-3" />
                                                                                Create New Location
                                                                            </span>
                                                                        </SelectItem>
                                                                        {existingLocations.map(existing => (
                                                                            <SelectItem key={existing.id} value={existing.id}>
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
                            <div className="flex items-center justify-between mb-5">
                                <div className="flex items-center gap-3">
                                    <h3 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200">Proposed Episodes</h3>
                                    <span className="bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 text-xs font-semibold px-2.5 py-0.5 rounded-full">
                                        {analysis.episodes.length}
                                    </span>
                                </div>
                                <Button variant="ghost" size="sm" className="text-xs text-zinc-500">
                                    Sort by
                                </Button>
                            </div>
                            <div className="space-y-4">
                                {analysis.episodes.map((ep) => (
                                    <div
                                        key={ep.number}
                                        className="group bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-5 shadow-sm hover:shadow-md hover:border-blue-300 dark:hover:border-blue-700 transition-all cursor-default relative"
                                    >
                                        <div className="flex items-start gap-5">
                                            <div className="flex-shrink-0 w-8 pt-1 text-center">
                                                <span className="text-sm font-bold font-mono text-zinc-400">
                                                    {String(ep.number).padStart(2, '0')}
                                                </span>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <h4 className="text-base font-semibold mb-1 text-zinc-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                                    {ep.title}
                                                </h4>
                                                <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed mb-3 line-clamp-2">
                                                    {ep.description}
                                                </p>
                                                <div className="flex flex-wrap gap-2 items-center">
                                                    {ep.character_names?.map(name => (
                                                        <span key={name} className="inline-flex items-center px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-[11px] font-medium text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
                                                            <Users className="w-3 h-3 mr-1 opacity-60" />
                                                            {name}
                                                        </span>
                                                    ))}
                                                    {ep.location_names?.map(name => (
                                                        <span key={name} className="inline-flex items-center px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-[11px] font-medium text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
                                                            <MapPin className="w-3 h-3 mr-1 opacity-60" />
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
                <div className="px-8 py-5 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex justify-between items-center">
                    {step === 'premise' ? (
                        <div />
                    ) : (
                        <Button
                            variant="ghost"
                            onClick={() => setStep(step === 'assets' ? 'premise' : 'assets')}
                            disabled={isPending}
                            className="text-zinc-500"
                        >
                            <ArrowLeft className="w-4 h-4 mr-2" />
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
                                className="bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all"
                            >
                                Next: Review Details
                                <ArrowRight className="w-4 h-4 ml-2" />
                            </Button>
                        )}
                        {step === 'assets' && (
                            <Button
                                onClick={() => setStep('generate')}
                                disabled={isPending}
                                className="bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all"
                            >
                                Next: Generate Episodes
                                <ArrowRight className="w-4 h-4 ml-2" />
                            </Button>
                        )}
                        {step === 'generate' && (
                            <div className="flex items-center gap-4">
                                <div className="hidden sm:flex items-center text-xs text-zinc-400 bg-zinc-50 dark:bg-zinc-800/50 px-3 py-1.5 rounded-full border border-zinc-100 dark:border-zinc-700/50">
                                    <Timer className="w-3.5 h-3.5 mr-1.5 text-blue-500" />
                                    Est. generation time: ~2 mins
                                </div>
                                <Button
                                    onClick={handleGenerate}
                                    disabled={isPending}
                                    className="bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 shadow-lg hover:shadow-xl transition-all"
                                >
                                    {isPending ? (
                                        <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            Generating...
                                        </>
                                    ) : (
                                        <>
                                            <Sparkles className="w-4 h-4 mr-2" />
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
