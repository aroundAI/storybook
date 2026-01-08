'use client';

import { useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@kit/ui/select';

interface LanguageSelectorProps {
    currentLanguage: string;
    availableLanguages: string[];
    disabled?: boolean;
}

const LANGUAGE_NAMES = new Intl.DisplayNames(['en'], { type: 'language' });

export function LanguageSelector({ currentLanguage, availableLanguages, disabled }: LanguageSelectorProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [pending, startTransition] = useTransition();

    const onChange = (value: string) => {
        startTransition(() => {
            const params = new URLSearchParams(searchParams.toString());
            params.set('lang', value);
            // Preserve scroll position or not? Usually better not to for video switch? 
            // Actually standard navigation is fine.
            router.replace(`?${params.toString()}`, { scroll: false });
        });
    };

    if (availableLanguages.length <= 1) return null;

    return (
        <Select value={currentLanguage} onValueChange={onChange} disabled={disabled || pending}>
            <SelectTrigger className="w-[140px]">
                <SelectValue>{KEYWORDS[currentLanguage] || LANGUAGE_NAMES.of(currentLanguage) || currentLanguage}</SelectValue>
            </SelectTrigger>
            <SelectContent>
                {availableLanguages.map((lang) => (
                    <SelectItem key={lang} value={lang}>
                        {KEYWORDS[lang] || LANGUAGE_NAMES.of(lang) || lang}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

// Simple map for common checks, fallback to Intl
const KEYWORDS: Record<string, string> = {
    en: 'English',
    es: 'Español',
    fr: 'Français',
    de: 'Deutsch',
    it: 'Italiano',
    pt: 'Português',
    ja: '日本語',
    ko: '한국어',
    zh: '中文',
};
