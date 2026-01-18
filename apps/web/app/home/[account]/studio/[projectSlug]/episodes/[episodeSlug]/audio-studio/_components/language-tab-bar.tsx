'use client';

import { useEffect, useState, useTransition } from 'react';

import { Globe, Loader2, Plus } from 'lucide-react';

import type { SupportedLanguage } from '@kit/audio-generation/lib';
import { translateDialogueToLanguageAction } from '@kit/audio-generation/server';
import { Button } from '@kit/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';
import { useLlmJob } from '@kit/ui/hooks';
import { toast } from '@kit/ui/sonner';

// Re-export for convenience
export type { SupportedLanguage };

// Language info with flags for UI display
const LANG_INFO: Record<SupportedLanguage, { name: string; flag: string }> = {
    en: { name: 'English', flag: '🇺🇸' },
    hi: { name: 'Hindi', flag: '🇮🇳' },
    es: { name: 'Spanish', flag: '🇪🇸' },
    pt: { name: 'Portuguese', flag: '🇧🇷' },
};

interface LanguageTabBarProps {
    episodeId: string;
    availableLanguages: SupportedLanguage[];
    selectedLanguage: SupportedLanguage;
    onLanguageChange: (lang: SupportedLanguage) => void;
    onLanguageAdded?: () => void;
}

export function LanguageTabBar({
    episodeId,
    availableLanguages,
    selectedLanguage,
    onLanguageChange,
    onLanguageAdded,
}: LanguageTabBarProps) {
    const [isTranslating, _startTransition] = useTransition();
    const [translatingTo, setTranslatingTo] = useState<SupportedLanguage | null>(null);

    // WebSocket for async LLM results (uses shared provider from layout)
    const { status: llmStatus, result: llmResult, error: llmError, trigger: triggerLlm } = useLlmJob<{ translatedCount: number }>(
        'translate-dialogue'
    );

    // Handle async WebSocket result
    useEffect(() => {
        if (llmStatus === 'success' && llmResult && translatingTo) {
            // llmResult is already the result object from message.result (contains {success, translatedCount})
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const resultData = llmResult as any;
            if (resultData?.success) {
                const count = resultData?.data?.translatedCount ?? resultData?.translatedCount ?? 0;
                toast.success(
                    `Translated ${count} lines to ${LANG_INFO[translatingTo].name}`
                );
                onLanguageAdded?.();
                onLanguageChange(translatingTo);
            }
            setTranslatingTo(null);
        } else if (llmStatus === 'error') {
            toast.error(llmError || 'Failed to translate dialogue');
            setTranslatingTo(null);
        }
    }, [llmStatus, llmResult, llmError, translatingTo, onLanguageAdded, onLanguageChange]);

    const missingLanguages = (['hi', 'es', 'pt'] as const).filter(
        (lang) => !availableLanguages.includes(lang)
    );

    const handleTranslate = (targetLang: 'hi' | 'es' | 'pt') => {
        setTranslatingTo(targetLang);
        triggerLlm(async () => {
            const result = await translateDialogueToLanguageAction({
                episodeId,
                targetLanguage: targetLang,
                preserveTiming: true,
            });

            // If queued, return queued flag (WebSocket will deliver result)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if ((result as any)?.queued) {
                toast.info('Translating dialogue in background...');
                return { queued: true };
            }
            // If local dev (synchronous), process immediately
            if (result.success) {
                toast.success(
                    `Translated ${result.translatedCount} lines to ${LANG_INFO[targetLang].name}`
                );
                onLanguageAdded?.();
                onLanguageChange(targetLang);
                setTranslatingTo(null);
                return { success: true, data: { translatedCount: result.translatedCount } };
            }
            throw new Error(result.error ?? 'Translation failed');
        });
    };

    return (
        <div className="flex items-center gap-1">
            {/* Language Tabs */}
            {availableLanguages.map((lang) => (
                <button
                    key={lang}
                    onClick={() => onLanguageChange(lang)}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${selectedLanguage === lang
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                        }`}
                >
                    <span>{LANG_INFO[lang].flag}</span>
                    <span>{LANG_INFO[lang].name}</span>
                </button>
            ))}

            {/* Add Language Button */}
            {missingLanguages.length > 0 && (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 px-2 text-xs"
                            disabled={isTranslating}
                        >
                            {isTranslating ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                                <Plus className="h-3 w-3" />
                            )}
                            <Globe className="h-3 w-3" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                        {missingLanguages.map((lang) => (
                            <DropdownMenuItem
                                key={lang}
                                onClick={() => handleTranslate(lang)}
                                disabled={translatingTo === lang}
                            >
                                <span className="mr-2">{LANG_INFO[lang].flag}</span>
                                Translate to {LANG_INFO[lang].name}
                                {translatingTo === lang && (
                                    <Loader2 className="ml-2 h-3 w-3 animate-spin" />
                                )}
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
        </div>
    );
}
