'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';

import Link from 'next/link';

import {
    BookOpen,
    Database,
    ExternalLink,
    Globe,
    Loader2,
    Plus,
    RefreshCw,
    Shield,
    Trash2,
    Upload,
} from 'lucide-react';

import {
    deleteExternalSourceAction,
    getResearchCountsAction,
    listExternalSourcesAction,
} from '@kit/episodes/server';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@kit/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kit/ui/tabs';
import { toast } from '@kit/ui/sonner';

import { AddSourceDialog } from './add-source-dialog';
import { UploadSourceDialog } from './upload-source-dialog';

interface ResearchHubPageProps {
    projectId: string;
    projectSlug: string;
    account: string;
}

interface Source {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    website_url: string | null;
    category: string;
    provider_type: string;
    credibility_tier: string | null;
    is_active: boolean;
    created_at: string;
}

const CREDIBILITY_COLORS: Record<string, string> = {
    tier_1: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    tier_2: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    tier_3: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

const CREDIBILITY_LABELS: Record<string, string> = {
    tier_1: 'High',
    tier_2: 'Medium',
    tier_3: 'Low',
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
    news: <Globe className="h-4 w-4" />,
    research: <BookOpen className="h-4 w-4" />,
    encyclopedia: <Database className="h-4 w-4" />,
    historical: <Shield className="h-4 w-4" />,
    official: <Shield className="h-4 w-4" />,
    multimedia: <Globe className="h-4 w-4" />,
};

export function ResearchHubPage({
    projectId,
    projectSlug,
    account,
}: ResearchHubPageProps) {
    const [isPending, startTransition] = useTransition();
    const [sources, setSources] = useState<Source[]>([]);
    const [counts, setCounts] = useState({ sources: 0, facts: 0 });
    const [showAddSource, setShowAddSource] = useState(false);
    const [showUpload, setShowUpload] = useState(false);

    const basePath = `/home/${account}/studio/${projectSlug}`;

    const loadData = useCallback(() => {
        startTransition(async () => {
            const [sourcesResult, countsResult] = await Promise.all([
                listExternalSourcesAction({ activeOnly: true }),
                getResearchCountsAction({ projectId }),
            ]);

            if (Array.isArray(sourcesResult)) {
                setSources(sourcesResult as Source[]);
            }

            if (countsResult && typeof countsResult === 'object' && 'sources' in countsResult) {
                setCounts(countsResult as { sources: number; facts: number });
            }
        });
    }, [projectId]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleDeleteSource = (sourceId: string) => {
        startTransition(async () => {
            try {
                await deleteExternalSourceAction({ sourceId });
                toast.success('Source removed');
                loadData();
            } catch {
                toast.error('Failed to remove source');
            }
        });
    };

    return (
        <div className="container mx-auto max-w-5xl space-y-6 px-4 py-4 sm:p-6">
            {/* Header */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Research Hub</h1>
                    <p className="text-muted-foreground mt-1 text-sm">
                        Manage external sources and verified facts for your content
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => setShowUpload(true)}>
                        <Upload className="mr-2 h-4 w-4" />
                        Upload Source
                    </Button>
                    <Button onClick={() => setShowAddSource(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        Add Source
                    </Button>
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Card>
                    <CardContent className="flex items-center gap-3 p-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
                            <Database className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold">{counts.sources}</p>
                            <p className="text-muted-foreground text-xs">Active Sources</p>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="flex items-center gap-3 p-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/30">
                            <BookOpen className="h-5 w-5 text-green-600 dark:text-green-400" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold">{counts.facts}</p>
                            <p className="text-muted-foreground text-xs">Verified Facts</p>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Tabs */}
            <Tabs defaultValue="sources" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="sources">
                        Sources ({sources.length})
                    </TabsTrigger>
                    <TabsTrigger value="facts">
                        Facts ({counts.facts})
                    </TabsTrigger>
                </TabsList>

                {/* Sources Tab */}
                <TabsContent value="sources" className="mt-4">
                    {sources.length === 0 ? (
                        <Card className="border-dashed">
                            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                                <Database className="text-muted-foreground mb-3 h-10 w-10" />
                                <h3 className="font-medium">No sources configured</h3>
                                <p className="text-muted-foreground mt-1 max-w-sm text-sm">
                                    Add external data sources to enrich your content with real-world
                                    facts and research.
                                </p>
                                <Button
                                    className="mt-4"
                                    onClick={() => setShowAddSource(true)}
                                >
                                    <Plus className="mr-2 h-4 w-4" />
                                    Add First Source
                                </Button>
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="space-y-3">
                            {sources.map((source) => (
                                <Card key={source.id}>
                                    <CardContent className="flex items-center gap-3 p-3 sm:gap-4 sm:p-4">
                                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                                            {CATEGORY_ICONS[source.category] ?? (
                                                <Globe className="h-4 w-4" />
                                            )}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <h3 className="truncate font-medium">
                                                    {source.name}
                                                </h3>
                                                <Badge variant="outline" className="text-xs capitalize">
                                                    {source.category}
                                                </Badge>
                                                {source.credibility_tier && (
                                                    <span
                                                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${CREDIBILITY_COLORS[source.credibility_tier] ?? ''}`}
                                                    >
                                                        {CREDIBILITY_LABELS[source.credibility_tier] ?? source.credibility_tier}
                                                    </span>
                                                )}
                                            </div>
                                            {source.description && (
                                                <p className="text-muted-foreground mt-0.5 truncate text-sm">
                                                    {source.description}
                                                </p>
                                            )}
                                        </div>
                                        <div className="flex shrink-0 items-center gap-1">
                                            {source.website_url && (
                                                <Button variant="ghost" size="icon" asChild>
                                                    <a
                                                        href={source.website_url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                    >
                                                        <ExternalLink className="h-4 w-4" />
                                                    </a>
                                                </Button>
                                            )}
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => handleDeleteSource(source.id)}
                                                disabled={isPending}
                                            >
                                                <Trash2 className="h-4 w-4 text-destructive" />
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </TabsContent>

                {/* Facts Tab */}
                <TabsContent value="facts" className="mt-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">Verified Facts</CardTitle>
                            <CardDescription>
                                Facts are managed per-project in the Facts Library
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Button variant="outline" asChild>
                                <Link href={`${basePath}/settings/facts`}>
                                    <BookOpen className="mr-2 h-4 w-4" />
                                    Open Facts Library
                                </Link>
                            </Button>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {/* Refresh */}
            <div className="flex justify-end">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={loadData}
                    disabled={isPending}
                >
                    {isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                        <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Refresh
                </Button>
            </div>

            {/* Add Source Dialog */}
            <AddSourceDialog
                open={showAddSource}
                onOpenChange={setShowAddSource}
                onSourceAdded={loadData}
            />

            {/* Upload Source Dialog */}
            <UploadSourceDialog
                open={showUpload}
                onOpenChange={setShowUpload}
                projectId={projectId}
                onComplete={loadData}
            />
        </div>
    );
}
