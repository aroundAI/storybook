'use client';

import { useState, useTransition } from 'react';

import { Globe, Loader2, Upload, FileText, Link2 } from 'lucide-react';

import {
    fetchUrlContentAction,
    uploadSourceContentAction,
    extractFactsFromContentAction,
} from '@kit/episodes/server';
import { SOURCE_CATEGORIES } from '@kit/episodes';
import { Button } from '@kit/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@kit/ui/dialog';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@kit/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kit/ui/tabs';
import { Textarea } from '@kit/ui/textarea';
import { toast } from '@kit/ui/sonner';

interface UploadSourceDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    projectId: string;
    onComplete: () => void;
}

export function UploadSourceDialog({
    open,
    onOpenChange,
    projectId,
    onComplete,
}: UploadSourceDialogProps) {
    const [isPending, startTransition] = useTransition();

    // Common fields
    const [name, setName] = useState('');
    const [category, setCategory] = useState<string>('research');

    // Text paste tab
    const [pastedContent, setPastedContent] = useState('');

    // URL tab
    const [url, setUrl] = useState('');
    const [fetchedContent, setFetchedContent] = useState('');

    // File tab
    const [fileContent, setFileContent] = useState('');
    const [fileName, setFileName] = useState('');

    // Results
    const [extractedCount, setExtractedCount] = useState<number | null>(null);

    const resetForm = () => {
        setName('');
        setCategory('research');
        setPastedContent('');
        setUrl('');
        setFetchedContent('');
        setFileContent('');
        setFileName('');
        setExtractedCount(null);
    };

    const handleFetchUrl = () => {
        if (!url.trim()) return;

        startTransition(async () => {
            try {
                const result = await fetchUrlContentAction({ url: url.trim() });
                if (result && typeof result === 'object' && 'content' in result) {
                    setFetchedContent((result as { content: string }).content);
                    if (!name) setName(url);
                    toast.success('URL content fetched');
                }
            } catch {
                toast.error('Failed to fetch URL content');
            }
        });
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setFileName(file.name);
        if (!name) setName(file.name);

        const reader = new FileReader();
        reader.onload = (ev) => {
            const text = ev.target?.result;
            if (typeof text === 'string') {
                setFileContent(text);
            }
        };
        reader.readAsText(file);
    };

    const getActiveContent = (tab: string) => {
        switch (tab) {
            case 'paste': return pastedContent;
            case 'url': return fetchedContent;
            case 'file': return fileContent;
            default: return '';
        }
    };

    const handleSubmit = (activeTab: string) => {
        const content = getActiveContent(activeTab);

        if (!name.trim() || !content.trim()) {
            toast.error('Name and content are required');
            return;
        }

        startTransition(async () => {
            try {
                // Upload source content
                await uploadSourceContentAction({
                    name: name.trim(),
                    content: content.trim(),
                    category: category as typeof SOURCE_CATEGORIES[number],
                    projectId,
                    sourceUrl: url.trim() || undefined,
                });

                // Extract facts from the content
                const result = await extractFactsFromContentAction({
                    content: content.trim(),
                    projectId,
                    sourceTitle: name.trim(),
                    sourceCitation: url.trim() || name.trim(),
                });

                if (result && typeof result === 'object' && 'extractedCount' in result) {
                    const count = (result as { extractedCount: number }).extractedCount;
                    setExtractedCount(count);
                    toast.success(`Extracted ${count} fact(s) from source`);
                }

                onComplete();
                onOpenChange(false);
                resetForm();
            } catch {
                toast.error('Failed to upload and extract facts');
            }
        });
    };

    const [activeTab, setActiveTab] = useState('paste');

    return (
        <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetForm(); }}>
            <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                    <DialogTitle>Upload Source & Extract Facts</DialogTitle>
                    <DialogDescription>
                        Provide content from a file, URL, or paste text to extract facts automatically
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {/* Name + Category */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="upload-name">Source Name *</Label>
                            <Input
                                id="upload-name"
                                placeholder="e.g., WHO Report 2024"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Category</Label>
                            <Select value={category} onValueChange={setCategory}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {SOURCE_CATEGORIES.map((cat) => (
                                        <SelectItem key={cat} value={cat}>
                                            <span className="capitalize">{cat}</span>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Content Input Tabs */}
                    <Tabs value={activeTab} onValueChange={setActiveTab}>
                        <TabsList className="grid w-full grid-cols-3">
                            <TabsTrigger value="paste">
                                <FileText className="mr-2 h-3 w-3" />
                                Paste Text
                            </TabsTrigger>
                            <TabsTrigger value="url">
                                <Link2 className="mr-2 h-3 w-3" />
                                From URL
                            </TabsTrigger>
                            <TabsTrigger value="file">
                                <Upload className="mr-2 h-3 w-3" />
                                Upload File
                            </TabsTrigger>
                        </TabsList>

                        <TabsContent value="paste" className="mt-3">
                            <Textarea
                                placeholder="Paste article text, research content, or any source material..."
                                value={pastedContent}
                                onChange={(e) => setPastedContent(e.target.value)}
                                rows={8}
                                className="font-mono text-sm"
                            />
                        </TabsContent>

                        <TabsContent value="url" className="mt-3 space-y-3">
                            <div className="flex gap-2">
                                <Input
                                    placeholder="https://example.com/article"
                                    value={url}
                                    onChange={(e) => setUrl(e.target.value)}
                                    className="flex-1"
                                />
                                <Button
                                    variant="outline"
                                    onClick={handleFetchUrl}
                                    disabled={isPending || !url.trim()}
                                >
                                    {isPending ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    ) : (
                                        <Globe className="mr-2 h-4 w-4" />
                                    )}
                                    Fetch
                                </Button>
                            </div>
                            {fetchedContent && (
                                <Textarea
                                    value={fetchedContent}
                                    readOnly
                                    rows={6}
                                    className="bg-muted font-mono text-xs"
                                />
                            )}
                        </TabsContent>

                        <TabsContent value="file" className="mt-3">
                            <div className="space-y-3">
                                <div className="flex items-center justify-center rounded-lg border-2 border-dashed p-6">
                                    <label
                                        htmlFor="file-upload"
                                        className="flex cursor-pointer flex-col items-center gap-2"
                                    >
                                        <Upload className="text-muted-foreground h-8 w-8" />
                                        <span className="text-muted-foreground text-sm">
                                            {fileName || 'Click to select a file (.txt, .md)'}
                                        </span>
                                        <input
                                            id="file-upload"
                                            type="file"
                                            accept=".txt,.md,.csv"
                                            onChange={handleFileChange}
                                            className="hidden"
                                        />
                                    </label>
                                </div>
                                {fileContent && (
                                    <p className="text-muted-foreground text-xs">
                                        Loaded {fileContent.length.toLocaleString()} characters
                                    </p>
                                )}
                            </div>
                        </TabsContent>
                    </Tabs>

                    {extractedCount !== null && (
                        <div className="rounded-lg bg-green-50 p-3 text-sm text-green-800 dark:bg-green-900/20 dark:text-green-400">
                            ✅ Extracted {extractedCount} fact(s) from this source
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => { onOpenChange(false); resetForm(); }}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={() => handleSubmit(activeTab)}
                        disabled={isPending || !name.trim() || !getActiveContent(activeTab).trim()}
                    >
                        {isPending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : null}
                        Upload & Extract Facts
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
