'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Youtube, Facebook } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@kit/ui/card';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@kit/ui/select';
import { toast } from '@kit/ui/sonner';

import { updateLocalizedVideosAction } from '@kit/public-sharing/server/visibility-actions';

interface VideoSource {
    youtube?: {
        video_id: string;
        url: string;
        channel_id: string;
    };
    facebook?: {
        video_id: string;
        url: string;
        page_id: string;
    };
}

interface VideoLinkManagerProps {
    episodeId: string;
    currentVideos: Record<string, VideoSource> | null;
}

const LANGUAGES = [
    { code: 'en', name: 'English', flag: '🇺🇸' },
    { code: 'es', name: 'Spanish', flag: '🇪🇸' },
    { code: 'hi', name: 'Hindi', flag: '🇮🇳' },
    { code: 'fr', name: 'French', flag: '🇫🇷' },
    { code: 'de', name: 'German', flag: '🇩🇪' },
    { code: 'pt', name: 'Portuguese', flag: '🇧🇷' },
    { code: 'ja', name: 'Japanese', flag: '🇯🇵' },
    { code: 'ko', name: 'Korean', flag: '🇰🇷' },
    { code: 'zh', name: 'Chinese', flag: '🇨🇳' },
    { code: 'ar', name: 'Arabic', flag: '🇸🇦' },
];

function extractYouTubeId(url: string): string | undefined {
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\s?]+)/,
    ];
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return undefined;
}

function extractFacebookVideoId(url: string): string | undefined {
    const patterns = [
        /facebook\.com\/.*\/videos\/(\d+)/,
        /facebook\.com\/watch\/\?v=(\d+)/,
    ];
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return undefined;
}

export function VideoLinkManager({ episodeId, currentVideos }: VideoLinkManagerProps) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [videos, setVideos] = useState<Record<string, VideoSource>>(currentVideos || {});
    const [newLanguage, setNewLanguage] = useState<string>('');

    const usedLanguages = Object.keys(videos);
    const availableLanguages = LANGUAGES.filter((l) => !usedLanguages.includes(l.code));

    const addLanguage = () => {
        if (!newLanguage) return;
        setVideos((prev) => ({
            ...prev,
            [newLanguage]: {},
        }));
        setNewLanguage('');
    };

    const removeLanguage = (langCode: string) => {
        setVideos((prev) => {
            const next = { ...prev };
            delete next[langCode];
            return next;
        });
    };

    const updateYouTubeUrl = (langCode: string, url: string) => {
        const videoId = extractYouTubeId(url);
        setVideos((prev) => ({
            ...prev,
            [langCode]: {
                ...prev[langCode],
                youtube: videoId
                    ? {
                        video_id: videoId,
                        url,
                        channel_id: '', // User can fill in later
                    }
                    : undefined,
            },
        }));
    };

    const updateFacebookUrl = (langCode: string, url: string) => {
        const videoId = extractFacebookVideoId(url);
        setVideos((prev) => ({
            ...prev,
            [langCode]: {
                ...prev[langCode],
                facebook: videoId
                    ? {
                        video_id: videoId,
                        url,
                        page_id: '', // User can fill in later
                    }
                    : undefined,
            },
        }));
    };

    const saveVideos = () => {
        startTransition(async () => {
            try {
                await updateLocalizedVideosAction({
                    episodeId,
                    localizedVideos: videos,
                });
                toast.success('Video links saved');
                router.refresh();
            } catch {
                toast.error('Failed to save video links');
            }
        });
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Youtube className="h-5 w-5" />
                    Multi-Language Videos
                </CardTitle>
                <CardDescription>
                    Add YouTube or Facebook video links for each language version
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* Existing Languages */}
                {usedLanguages.map((langCode) => {
                    const lang = LANGUAGES.find((l) => l.code === langCode);
                    const video = videos[langCode];

                    return (
                        <div key={langCode} className="border rounded-lg p-4 space-y-4">
                            <div className="flex items-center justify-between">
                                <h4 className="font-medium">
                                    {lang?.flag} {lang?.name || langCode}
                                </h4>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => removeLanguage(langCode)}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>

                            <div className="space-y-3">
                                <div>
                                    <Label className="flex items-center gap-2 mb-2">
                                        <Youtube className="h-4 w-4 text-red-500" />
                                        YouTube Video URL
                                    </Label>
                                    <Input
                                        placeholder="https://youtube.com/watch?v=..."
                                        value={video?.youtube?.url || ''}
                                        onChange={(e) => updateYouTubeUrl(langCode, e.target.value)}
                                    />
                                </div>

                                <div>
                                    <Label className="flex items-center gap-2 mb-2">
                                        <Facebook className="h-4 w-4 text-blue-600" />
                                        Facebook Video URL
                                    </Label>
                                    <Input
                                        placeholder="https://facebook.com/watch?v=..."
                                        value={video?.facebook?.url || ''}
                                        onChange={(e) => updateFacebookUrl(langCode, e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>
                    );
                })}

                {/* Add New Language */}
                {availableLanguages.length > 0 && (
                    <div className="flex gap-2">
                        <Select value={newLanguage} onValueChange={setNewLanguage}>
                            <SelectTrigger className="flex-1">
                                <SelectValue placeholder="Add a language..." />
                            </SelectTrigger>
                            <SelectContent>
                                {availableLanguages.map((lang) => (
                                    <SelectItem key={lang.code} value={lang.code}>
                                        {lang.flag} {lang.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button onClick={addLanguage} disabled={!newLanguage}>
                            <Plus className="h-4 w-4" />
                        </Button>
                    </div>
                )}

                {usedLanguages.length === 0 && (
                    <p className="text-center text-muted-foreground py-4">
                        No video links added yet. Add a language to get started.
                    </p>
                )}

                {usedLanguages.length > 0 && (
                    <div className="flex justify-end pt-4 border-t">
                        <Button onClick={saveVideos} disabled={isPending}>
                            {isPending ? 'Saving...' : 'Save Video Links'}
                        </Button>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
