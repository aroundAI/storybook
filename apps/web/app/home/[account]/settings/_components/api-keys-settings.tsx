'use client';

import { useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    CheckCircle,
    ExternalLink,
    Key,
    Loader2,
    Trash2,
    XCircle,
} from 'lucide-react';

import { Alert, AlertDescription } from '@kit/ui/alert';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@kit/ui/card';
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
import { toast } from '@kit/ui/sonner';

import type { ApiKeyInfo, ApiKeyProvider } from '../_lib/api-keys.schema';
import {
    deleteApiKeyAction,
    getApiKeysAction,
    saveApiKeyAction,
    validateApiKeyAction,
} from '../_lib/server/api-keys-actions';

interface Provider {
    id: ApiKeyProvider;
    name: string;
    description: string;
    category: 'video' | 'audio' | 'llm';
    docsUrl: string;
    keyFormat: string;
}

const PROVIDERS: Provider[] = [
    {
        id: 'kling',
        name: 'Kling (via PiAPI)',
        description: 'AI video generation with Kling models',
        category: 'video',
        docsUrl: 'https://piapi.ai/docs',
        keyFormat: 'Bearer token',
    },
    {
        id: 'runway',
        name: 'Runway',
        description: 'Runway Gen-3 video generation',
        category: 'video',
        docsUrl: 'https://docs.runwayml.com/api',
        keyFormat: 'API key starting with rn_',
    },
    {
        id: 'hailuo',
        name: 'Hailuo/MiniMax',
        description: 'Hailuo AI video generation',
        category: 'video',
        docsUrl: 'https://docs.minimax.chat',
        keyFormat: 'API key',
    },
    {
        id: 'elevenlabs',
        name: 'ElevenLabs',
        description: 'AI voice generation and cloning',
        category: 'audio',
        docsUrl: 'https://docs.elevenlabs.io',
        keyFormat: 'API key from dashboard',
    },
    {
        id: 'playht',
        name: 'PlayHT',
        description: 'AI voice synthesis',
        category: 'audio',
        docsUrl: 'https://docs.play.ht',
        keyFormat: 'API key',
    },
    {
        id: 'suno',
        name: 'Suno',
        description: 'AI music generation',
        category: 'audio',
        docsUrl: 'https://suno.ai/developers',
        keyFormat: 'API key',
    },
    {
        id: 'openai',
        name: 'OpenAI',
        description: 'GPT models for story generation',
        category: 'llm',
        docsUrl: 'https://platform.openai.com/docs',
        keyFormat: 'Key starting with sk-',
    },
    {
        id: 'claude',
        name: 'Anthropic Claude',
        description: 'Claude models for story generation',
        category: 'llm',
        docsUrl: 'https://docs.anthropic.com',
        keyFormat: 'Key starting with sk-ant-',
    },
    {
        id: 'gemini',
        name: 'Google Gemini',
        description: 'Gemini models for story generation',
        category: 'llm',
        docsUrl: 'https://ai.google.dev/docs',
        keyFormat: 'API key',
    },
];

interface ApiKeysSettingsProps {
    accountSlug: string;
}

export function ApiKeysSettings({ accountSlug }: ApiKeysSettingsProps) {
    const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
    const queryClient = useQueryClient();

    const { data: savedKeys, isLoading } = useQuery({
        queryKey: ['api-keys', accountSlug],
        queryFn: () => getApiKeysAction({ accountSlug }),
    });

    const categories = [
        { id: 'video', label: 'Video Generation' },
        { id: 'audio', label: 'Audio Generation' },
        { id: 'llm', label: 'Language Models' },
    ] as const;

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
            </div>
        );
    }

    return (
        <div className="space-y-8">
            {categories.map((category) => (
                <div key={category.id} className="space-y-4">
                    <h2 className="text-lg font-semibold">{category.label}</h2>
                    <div className="grid gap-4 md:grid-cols-2">
                        {PROVIDERS.filter((p) => p.category === category.id).map(
                            (provider) => {
                                const savedKey = savedKeys?.find(
                                    (k) => k.provider === provider.id,
                                );

                                return (
                                    <ProviderCard
                                        key={provider.id}
                                        provider={provider}
                                        savedKey={savedKey}
                                        onEdit={() => setEditingProvider(provider)}
                                    />
                                );
                            },
                        )}
                    </div>
                </div>
            ))}

            {editingProvider && (
                <ApiKeyDialog
                    provider={editingProvider}
                    accountSlug={accountSlug}
                    existingKey={savedKeys?.find(
                        (k) => k.provider === editingProvider.id,
                    )}
                    onClose={() => setEditingProvider(null)}
                    onSave={() => {
                        queryClient.invalidateQueries({
                            queryKey: ['api-keys', accountSlug],
                        });
                        setEditingProvider(null);
                    }}
                />
            )}
        </div>
    );
}

interface ProviderCardProps {
    provider: Provider;
    savedKey?: ApiKeyInfo;
    onEdit: () => void;
}

function ProviderCard({ provider, savedKey, onEdit }: ProviderCardProps) {
    return (
        <Card>
            <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                    <div>
                        <CardTitle className="text-base">{provider.name}</CardTitle>
                        <CardDescription className="text-sm">
                            {provider.description}
                        </CardDescription>
                    </div>
                    {savedKey ? (
                        <Badge variant={savedKey.isActive ? 'default' : 'secondary'}>
                            {savedKey.isActive ? 'Connected' : 'Inactive'}
                        </Badge>
                    ) : (
                        <Badge variant="outline">Not configured</Badge>
                    )}
                </div>
            </CardHeader>
            <CardContent>
                <div className="flex items-center justify-between">
                    {savedKey ? (
                        <div className="text-muted-foreground flex items-center gap-2 text-sm">
                            <Key className="h-4 w-4" />
                            <span>{'••••••' + savedKey.lastFourChars}</span>
                        </div>
                    ) : (
                        <span className="text-muted-foreground text-sm">No key saved</span>
                    )}
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" asChild>
                            <a
                                href={provider.docsUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                <ExternalLink className="h-4 w-4" />
                            </a>
                        </Button>
                        <Button variant="outline" size="sm" onClick={onEdit}>
                            {savedKey ? 'Update' : 'Add Key'}
                        </Button>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

interface ApiKeyDialogProps {
    provider: Provider;
    accountSlug: string;
    existingKey?: ApiKeyInfo;
    onClose: () => void;
    onSave: () => void;
}

function ApiKeyDialog({
    provider,
    accountSlug,
    existingKey,
    onClose,
    onSave,
}: ApiKeyDialogProps) {
    const [formState, setFormState] = useState<{
        apiKey: string;
        validationStatus: 'idle' | 'validating' | 'valid' | 'invalid';
        error: string | null;
    }>({
        apiKey: '',
        validationStatus: 'idle',
        error: null,
    });

    const saveMutation = useMutation({
        mutationFn: () =>
            saveApiKeyAction({
                accountSlug,
                provider: provider.id,
                apiKey: formState.apiKey,
            }),
        onSuccess: () => {
            toast.success('API key saved successfully');
            onSave();
        },
        onError: (err) => {
            setFormState((prev) => ({ ...prev, error: err instanceof Error ? err.message : 'Failed to save key' }));
        },
    });

    const deleteMutation = useMutation({
        mutationFn: () =>
            deleteApiKeyAction({
                accountSlug,
                provider: provider.id,
            }),
        onSuccess: () => {
            toast.success('API key removed successfully');
            onSave();
        },
        onError: (err) => {
            setFormState((prev) => ({ ...prev, error: err instanceof Error ? err.message : 'Failed to remove key' }));
        },
    });

    const validateKey = async () => {
        if (!formState.apiKey) return;

        setFormState((prev) => ({ ...prev, validationStatus: 'validating', error: null }));

        try {
            const result = await validateApiKeyAction({
                provider: provider.id,
                apiKey: formState.apiKey,
            });
            setFormState((prev) => ({
                ...prev,
                validationStatus: result.valid ? 'valid' : 'invalid',
                error: result.valid ? null : (result.error ?? 'Invalid API key'),
            }));
        } catch (err) {
            setFormState((prev) => ({
                ...prev,
                validationStatus: 'invalid',
                error: err instanceof Error ? err.message : 'Failed to validate key',
            }));
        }
    };

    return (
        <Dialog open onOpenChange={onClose}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {existingKey ? 'Update' : 'Add'} {provider.name} API Key
                    </DialogTitle>
                    <DialogDescription>
                        {provider.description}. Format: {provider.keyFormat}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="api-key">API Key</Label>
                        <div className="flex gap-2">
                            <Input
                                id="api-key"
                                type="password"
                                placeholder={`Enter your ${provider.name} API key`}
                                value={formState.apiKey}
                                onChange={(e) => {
                                    setFormState({
                                        apiKey: e.target.value,
                                        validationStatus: 'idle',
                                        error: null,
                                    });
                                }}
                            />
                            <Button
                                variant="outline"
                                onClick={validateKey}
                                disabled={!formState.apiKey || formState.validationStatus === 'validating'}
                            >
                                {formState.validationStatus === 'validating' ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : formState.validationStatus === 'valid' ? (
                                    <CheckCircle className="h-4 w-4 text-green-500" />
                                ) : formState.validationStatus === 'invalid' ? (
                                    <XCircle className="h-4 w-4 text-red-500" />
                                ) : (
                                    'Test'
                                )}
                            </Button>
                        </div>
                    </div>

                    {formState.error && (
                        <Alert variant="destructive">
                            <AlertDescription>{formState.error}</AlertDescription>
                        </Alert>
                    )}

                    {formState.validationStatus === 'valid' && (
                        <Alert>
                            <CheckCircle className="h-4 w-4" />
                            <AlertDescription>API key is valid and working!</AlertDescription>
                        </Alert>
                    )}

                    <p className="text-muted-foreground text-xs">
                        Your API key is encrypted before storage. We never share your keys
                        with third parties.
                        <a
                            href={provider.docsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-1 underline"
                        >
                            Get your API key
                        </a>
                    </p>
                </div>

                <DialogFooter className="flex justify-between">
                    <div>
                        {existingKey && (
                            <Button
                                variant="destructive"
                                onClick={() => deleteMutation.mutate()}
                                disabled={deleteMutation.isPending}
                            >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Remove Key
                            </Button>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button
                            onClick={() => saveMutation.mutate()}
                            disabled={
                                !formState.apiKey ||
                                formState.validationStatus !== 'valid' ||
                                saveMutation.isPending
                            }
                        >
                            {saveMutation.isPending ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : null}
                            Save Key
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
