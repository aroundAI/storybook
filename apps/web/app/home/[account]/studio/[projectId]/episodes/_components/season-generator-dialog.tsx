'use client';

import { useState, useTransition } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Check, Loader2, Plus, Sparkles, Users, MapPin } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from '@kit/ui/sonner';

import { useAssets } from '@kit/assets/hooks';
import { AnalyzeSeasonSchema } from '@kit/episodes/schemas';
import { analyzeSeasonRoadmapAction, generateSeasonEpisodesAction } from '@kit/episodes/server/season-generation';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@kit/ui/dialog';
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@kit/ui/form';
import { Label } from '@kit/ui/label';

import { ScrollArea } from '@kit/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@kit/ui/select';
import { Separator } from '@kit/ui/separator';
import { Textarea } from '@kit/ui/textarea';
import { cn } from '@kit/ui/utils';

interface SeasonGeneratorDialogProps {
    projectId: string;
}

type Step = 'input' | 'analysis' | 'generating';

interface AnalysisResult {
    premise: string;
    characters: Array<{ name: string; role: string; description: string }>;
    locations: Array<{ name: string; setting: string; description: string }>;
    episodes: Array<{ number: number; title: string; description: string; character_names: string[]; location_names: string[] }>;
}

export function SeasonGeneratorDialog({ projectId }: SeasonGeneratorDialogProps) {
    const [open, setOpen] = useState(false);
    const [step, setStep] = useState<Step>('input');
    const [isPending, startTransition] = useTransition();

    // Analysis State
    const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
    const [premise, setPremise] = useState('');

    // Mapping State: Name -> AssetID (or 'NEW')
    const [charMapping, setCharMapping] = useState<Record<string, string>>({});
    const [locMapping, setLocMapping] = useState<Record<string, string>>({});

    const { assets: existingCharacters, isLoading: isLoadingChars } = useAssets({
        projectId,
        type: 'character',
        limit: 100,
    });

    const { assets: existingLocations, isLoading: isLoadingLocs } = useAssets({
        projectId,
        type: 'location',
        limit: 100,
    });

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

                    // Auto-map Characters
                    const initialCharMapping: Record<string, string> = {};
                    result.data.characters.forEach(c => {
                        const match = existingCharacters.find(ex => ex.name.toLowerCase() === c.name.toLowerCase());
                        initialCharMapping[c.name] = match ? match.id : 'NEW';
                    });
                    setCharMapping(initialCharMapping);

                    // Auto-map Locations
                    const initialLocMapping: Record<string, string> = {};
                    result.data.locations?.forEach(l => {
                        const match = existingLocations.find(ex => ex.name.toLowerCase() === l.name.toLowerCase());
                        initialLocMapping[l.name] = match ? match.id : 'NEW';
                    });
                    setLocMapping(initialLocMapping);

                    setStep('analysis');
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
                        setStep('input');
                        form.reset();
                        setAnalysis(null);
                    }, 500);
                } else {
                    toast.error('Failed to generate season');
                }
            } catch {
                toast.error('Failed to generate season');
            }
        });
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" className="border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                    <Plus className="mr-2 h-4 w-4" />
                    Generate Season
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[900px] h-[85vh] flex flex-col bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
                {/* Step Indicator */}
                <div className="absolute top-4 right-12 flex items-center gap-2">
                    <div className={cn(
                        "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                        step === 'input'
                            ? "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300"
                            : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500"
                    )}>
                        <span className="w-5 h-5 rounded-full bg-purple-500 text-white flex items-center justify-center text-xs font-bold">1</span>
                        Premise
                    </div>
                    <div className="w-4 h-0.5 bg-zinc-200 dark:bg-zinc-700" />
                    <div className={cn(
                        "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                        step === 'analysis'
                            ? "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300"
                            : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500"
                    )}>
                        <span className={cn(
                            "w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold",
                            step === 'analysis' ? "bg-purple-500 text-white" : "bg-zinc-300 dark:bg-zinc-600 text-zinc-500"
                        )}>2</span>
                        Assets
                    </div>
                    <div className="w-4 h-0.5 bg-zinc-200 dark:bg-zinc-700" />
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
                        <span className="w-5 h-5 rounded-full bg-zinc-300 dark:bg-zinc-600 text-zinc-500 flex items-center justify-center text-xs font-bold">3</span>
                        Generate
                    </div>
                </div>

                <DialogHeader className="pb-4 border-b border-zinc-200 dark:border-zinc-800">
                    <DialogTitle className="text-2xl font-bold text-zinc-900 dark:text-white flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                            <Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                        </div>
                        Generate Season
                    </DialogTitle>
                    <DialogDescription className="text-zinc-500 dark:text-zinc-400">
                        {step === 'input' && "Paste your roadmap or series bible to analyze and extract episodes and characters."}
                        {step === 'analysis' && "Review extracted details and map characters to existing or new assets."}
                        {step === 'generating' && "Generating assets and episodes..."}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto px-1 py-6">
                    {step === 'input' && (
                        <Form {...form}>
                            <form id="analyze-form" onSubmit={form.handleSubmit(handleAnalyze)} className="space-y-6">
                                <FormField
                                    control={form.control}
                                    name="roadmap"
                                    render={({ field }) => (
                                        <FormItem>
                                            <div className="flex items-center justify-between mb-3">
                                                <FormLabel className="text-sm font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
                                                    <Sparkles className="w-4 h-4 text-purple-500" />
                                                    Production Roadmap / Series Bible
                                                </FormLabel>
                                                <span className="text-xs font-medium text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded">
                                                    Markdown Supported
                                                </span>
                                            </div>
                                            <FormControl>
                                                <Textarea
                                                    placeholder="# Detective Dante & Cece
## Season 1 Production Roadmap
---
## 📋 Series Overview
**Title:** Detective Dante & Cece
**Format:** Animated children's series
**Target Age:** 3+ years
..."
                                                    className="min-h-[350px] font-mono text-sm bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 resize-none"
                                                    {...field}
                                                />
                                            </FormControl>
                                            <FormDescription className="text-zinc-500">
                                                Include episode summaries, character arcs, and key plot points for best results.
                                            </FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </form>
                        </Form>
                    )}

                    {step === 'analysis' && analysis && (
                        <div className="space-y-6">
                            {/* Premise Section */}
                            <div className="space-y-2">
                                <Label>Season Premise</Label>
                                <Textarea
                                    value={premise}
                                    onChange={(e) => setPremise(e.target.value)}
                                    className="min-h-[80px]"
                                />
                            </div>

                            <Separator />

                            {/* Character Mapping Section */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <Label className="flex items-center gap-2">
                                        <Users className="h-4 w-4" />
                                        Characters ({analysis.characters.length})
                                    </Label>
                                    {isLoadingChars && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                                </div>
                                <div className="grid gap-3">
                                    {analysis.characters.map((char, idx) => (
                                        <div key={idx} className="flex items-start gap-3 p-3 border rounded-md bg-muted/30">
                                            <div className="flex-1">
                                                <div className="font-medium text-sm flex items-center gap-2">
                                                    {char.name}
                                                    <Badge variant="outline" className="text-[10px]">{char.role}</Badge>
                                                </div>
                                                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{char.description}</p>
                                            </div>
                                            <div className="w-[200px]">
                                                <Select
                                                    value={charMapping[char.name] || 'NEW'}
                                                    onValueChange={(val) => setCharMapping(prev => ({ ...prev, [char.name]: val }))}
                                                >
                                                    <SelectTrigger className="h-8 text-xs">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="NEW">✨ Create New Asset</SelectItem>
                                                        {existingCharacters.map(asset => (
                                                            <SelectItem key={asset.id} value={asset.id}>
                                                                Link: {asset.name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <Separator />

                            {/* Location Mapping Section */}
                            {analysis.locations && analysis.locations.length > 0 && (
                                <>
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <Label className="flex items-center gap-2">
                                                <MapPin className="h-4 w-4" />
                                                Locations ({analysis.locations.length})
                                            </Label>
                                            {isLoadingLocs && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                                        </div>
                                        <div className="grid gap-3">
                                            {analysis.locations.map((loc, idx) => (
                                                <div key={idx} className="flex items-start gap-3 p-3 border rounded-md bg-muted/30">
                                                    <div className="flex-1">
                                                        <div className="font-medium text-sm flex items-center gap-2">
                                                            {loc.name}
                                                            <Badge variant="outline" className="text-[10px]">{loc.setting}</Badge>
                                                        </div>
                                                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{loc.description}</p>
                                                    </div>
                                                    <div className="w-[200px]">
                                                        <Select
                                                            value={locMapping[loc.name] || 'NEW'}
                                                            onValueChange={(val) => setLocMapping(prev => ({ ...prev, [loc.name]: val }))}
                                                        >
                                                            <SelectTrigger className="h-8 text-xs">
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="NEW">✨ Create New Asset</SelectItem>
                                                                {existingLocations.map(asset => (
                                                                    <SelectItem key={asset.id} value={asset.id}>
                                                                        Link: {asset.name}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    <Separator />
                                </>
                            )}

                            {/* Episodes Preview */}
                            <div className="space-y-2">
                                <Label>Episodes ({analysis.episodes.length})</Label>
                                <ScrollArea className="h-[200px] border rounded-md p-4">
                                    <div className="space-y-4">
                                        {analysis.episodes.map(ep => (
                                            <div key={ep.number} className="text-sm">
                                                <span className="font-semibold mr-2">{ep.number}. {ep.title}</span>
                                                <span className="text-muted-foreground">- {ep.description}</span>
                                                {ep.character_names && ep.character_names.length > 0 && (
                                                    <div className="mt-1 flex flex-wrap gap-1">
                                                        {ep.character_names.map(c => (
                                                            <Badge key={c} variant="secondary" className="text-[10px] px-1 py-0">{c}</Badge>
                                                        ))}
                                                        {ep.location_names?.map(l => (
                                                            <Badge key={l} variant="outline" className="text-[10px] px-1 py-0 flex items-center gap-1">
                                                                <MapPin className="h-2 w-2" />
                                                                {l}
                                                            </Badge>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </ScrollArea>
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter className="mt-4">
                    {step === 'input' ? (
                        <Button
                            type="submit"
                            form="analyze-form"
                            disabled={isPending || !form.formState.isValid}
                        >
                            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                            Analyze Roadmap
                        </Button>
                    ) : (
                        <div className="flex gap-2 w-full justify-end">
                            <Button variant="ghost" onClick={() => setStep('input')} disabled={isPending}>
                                Back
                            </Button>
                            <Button onClick={handleGenerate} disabled={isPending}>
                                {isPending ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Generating Assets & Episodes...
                                    </>
                                ) : (
                                    <>
                                        <Check className="mr-2 h-4 w-4" />
                                        Confirm & Generate
                                    </>
                                )}
                            </Button>
                        </div>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
