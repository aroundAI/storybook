'use client';

import { useState, useTransition } from 'react';

import {
    BookOpen,
    Database,
    Globe,
    Loader2,
    Shield,
} from 'lucide-react';

import { addExternalSourceAction } from '@kit/episodes/server';
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
import { Textarea } from '@kit/ui/textarea';
import { toast } from '@kit/ui/sonner';

interface AddSourceDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSourceAdded: () => void;
}

const PROVIDER_TYPES = [
    { value: 'manual', label: 'Manual Entry' },
    { value: 'newsapi', label: 'NewsAPI' },
    { value: 'semantic_scholar', label: 'Semantic Scholar' },
    { value: 'archive_org', label: 'Internet Archive' },
    { value: 'wikipedia', label: 'Wikipedia' },
    { value: 'custom_api', label: 'Custom API' },
] as const;

export function AddSourceDialog({
    open,
    onOpenChange,
    onSourceAdded,
}: AddSourceDialogProps) {
    const [isPending, startTransition] = useTransition();
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [websiteUrl, setWebsiteUrl] = useState('');
    const [category, setCategory] = useState<string>('');
    const [providerType, setProviderType] = useState<string>('manual');
    const [credibilityTier, setCredibilityTier] = useState<string>('tier_3');
    const [apiEndpoint, setApiEndpoint] = useState('');

    const generateSlug = (text: string) =>
        text
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 100);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        if (!name.trim() || !category) {
            toast.error('Name and category are required');
            return;
        }

        startTransition(async () => {
            try {
                await addExternalSourceAction({
                    name: name.trim(),
                    slug: generateSlug(name),
                    description: description.trim() || undefined,
                    websiteUrl: websiteUrl.trim() || undefined,
                    apiEndpoint: apiEndpoint.trim() || undefined,
                    category: category as typeof SOURCE_CATEGORIES[number],
                    providerType: providerType || 'manual',
                    credibilityTier: credibilityTier as 'tier_1' | 'tier_2' | 'tier_3',
                });

                toast.success('Source added successfully');
                onSourceAdded();
                onOpenChange(false);

                // Reset form
                setName('');
                setDescription('');
                setWebsiteUrl('');
                setCategory('');
                setProviderType('manual');
                setCredibilityTier('tier_3');
                setApiEndpoint('');
            } catch {
                toast.error('Failed to add source');
            }
        });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>Add External Source</DialogTitle>
                    <DialogDescription>
                        Register a new data source for research and fact-checking
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="source-name">Name *</Label>
                        <Input
                            id="source-name"
                            placeholder="e.g., Reuters, Nature, Wikipedia"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="source-description">Description</Label>
                        <Textarea
                            id="source-description"
                            placeholder="Brief description of this source..."
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows={2}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="source-url">Website URL</Label>
                        <Input
                            id="source-url"
                            type="url"
                            placeholder="https://..."
                            value={websiteUrl}
                            onChange={(e) => setWebsiteUrl(e.target.value)}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Category *</Label>
                            <Select value={category} onValueChange={setCategory}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select..." />
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

                        <div className="space-y-2">
                            <Label>Provider Type</Label>
                            <Select value={providerType} onValueChange={setProviderType}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {PROVIDER_TYPES.map((pt) => (
                                        <SelectItem key={pt.value} value={pt.value}>
                                            {pt.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* API Endpoint — shown for API provider types */}
                    {(providerType === 'custom_api' || providerType === 'newsapi' || providerType === 'semantic_scholar') && (
                        <div className="space-y-2">
                            <Label htmlFor="api-endpoint">API Endpoint URL</Label>
                            <Input
                                id="api-endpoint"
                                type="url"
                                placeholder="https://api.example.com/v1/search"
                                value={apiEndpoint}
                                onChange={(e) => setApiEndpoint(e.target.value)}
                            />
                            <p className="text-muted-foreground text-xs">
                                The API endpoint used to fetch content from this source
                            </p>
                        </div>
                    )}

                    <div className="space-y-2">
                        <Label>Credibility Tier</Label>
                        <Select value={credibilityTier} onValueChange={setCredibilityTier}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="tier_1">
                                    <span className="flex items-center gap-2">
                                        <Shield className="h-3 w-3 text-green-600" />
                                        Tier 1 — High (peer-reviewed, established)
                                    </span>
                                </SelectItem>
                                <SelectItem value="tier_2">
                                    <span className="flex items-center gap-2">
                                        <Shield className="h-3 w-3 text-yellow-600" />
                                        Tier 2 — Medium (reputable, editorial)
                                    </span>
                                </SelectItem>
                                <SelectItem value="tier_3">
                                    <span className="flex items-center gap-2">
                                        <Shield className="h-3 w-3 text-red-600" />
                                        Tier 3 — Low (user-generated, unverified)
                                    </span>
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isPending || !name.trim() || !category}>
                            {isPending ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : null}
                            Add Source
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
