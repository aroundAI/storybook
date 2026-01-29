'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, XCircle, Info, X } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@kit/ui/alert';
import { Button } from '@kit/ui/button';
import { validateContentInlineAction } from '@kit/episodes/server';

interface InlineViolationWarningProps {
    projectId: string;
    episodeId: string;
    storyContent: string;
    onDismiss?: () => void;
}

interface Violation {
    code: string;
    severity: 'error' | 'warning' | 'info';
    message: string;
    suggestion: string;
}

/**
 * Inline Violation Warning - Displays canon violations in Story tab
 * FILM-1007 Component (Step 4)
 */
export function InlineViolationWarning({
    projectId,
    episodeId,
    storyContent,
    onDismiss,
}: InlineViolationWarningProps) {
    const [violations, setViolations] = useState<Violation[]>([]);
    const [isValidating, setIsValidating] = useState(false);
    const [isDismissed, setIsDismissed] = useState(false);

    // Debounced validation
    const validate = useCallback(async () => {
        if (!storyContent || storyContent.length < 100) {
            setViolations([]);
            return;
        }

        setIsValidating(true);
        try {
            const result = await validateContentInlineAction({
                projectId,
                episodeId,
                content: storyContent,
            });

            if (result?.violations) {
                setViolations(result.violations);
            }
        } catch (error) {
            console.error('Validation error:', error);
        } finally {
            setIsValidating(false);
        }
    }, [projectId, episodeId, storyContent]);

    // Debounce validation on content change
    useEffect(() => {
        const timer = setTimeout(() => {
            validate();
        }, 1500); // 1.5s debounce

        return () => clearTimeout(timer);
    }, [validate]);

    // Don't show if dismissed or no violations
    if (isDismissed || violations.length === 0) {
        return null;
    }

    const handleDismiss = () => {
        setIsDismissed(true);
        onDismiss?.();
    };

    const errorCount = violations.filter((v) => v.severity === 'error').length;
    const warningCount = violations.filter((v) => v.severity === 'warning').length;

    const getIcon = (severity: Violation['severity']) => {
        switch (severity) {
            case 'error':
                return <XCircle className="h-4 w-4 text-red-500" />;
            case 'warning':
                return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
            default:
                return <Info className="h-4 w-4 text-blue-500" />;
        }
    };

    return (
        <Alert
            variant={errorCount > 0 ? 'destructive' : 'default'}
            className="relative mb-4"
        >
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle className="flex items-center justify-between">
                <span>
                    Canon Validation{' '}
                    {isValidating ? (
                        <span className="text-muted-foreground text-sm">(checking...)</span>
                    ) : (
                        <span className="text-sm font-normal">
                            ({errorCount} error{errorCount !== 1 ? 's' : ''}, {warningCount}{' '}
                            warning{warningCount !== 1 ? 's' : ''})
                        </span>
                    )}
                </span>
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={handleDismiss}
                >
                    <X className="h-4 w-4" />
                </Button>
            </AlertTitle>
            <AlertDescription>
                <ul className="mt-2 space-y-2">
                    {violations.map((v, i) => (
                        <li key={`${v.code}-${i}`} className="flex gap-2 text-sm">
                            {getIcon(v.severity)}
                            <div>
                                <span className="font-medium">[{v.code}]</span> {v.message}
                                <p className="text-muted-foreground text-xs mt-0.5">
                                    💡 {v.suggestion}
                                </p>
                            </div>
                        </li>
                    ))}
                </ul>
            </AlertDescription>
        </Alert>
    );
}
