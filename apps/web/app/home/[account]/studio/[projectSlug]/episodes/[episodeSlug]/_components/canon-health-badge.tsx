'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@kit/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@kit/ui/tooltip';
import { CheckCircle2, AlertTriangle, XCircle, Loader2 } from 'lucide-react';
import { getCanonHealthAction } from '@kit/episodes/server';

interface CanonHealthBadgeProps {
    projectId: string;
    className?: string;
}

type HealthStatus = 'ok' | 'warning' | 'error' | 'loading';

/**
 * Canon Health Badge - Displays canon validation status in episode header
 * FILM-1007 Component 5
 */
export function CanonHealthBadge({ projectId, className }: CanonHealthBadgeProps) {
    const [status, setStatus] = useState<HealthStatus>('loading');
    const [issueCount, setIssueCount] = useState(0);
    const [message, setMessage] = useState('');

    useEffect(() => {
        async function checkCanonHealth() {
            try {
                const result = await getCanonHealthAction({ projectId });

                if (!result) {
                    setStatus('ok');
                    setMessage('Canon not configured');
                    return;
                }

                // Use health status from the action
                const { health, stats } = result;

                if (health.status === 'ok') {
                    setStatus('ok');
                    setMessage(`${stats.immutableEvents} canon events tracked`);
                    setIssueCount(0);
                } else if (health.status === 'warning') {
                    setStatus('warning');
                    setMessage(`${health.issueCount} issue${health.issueCount > 1 ? 's' : ''} detected`);
                    setIssueCount(health.issueCount);
                } else {
                    setStatus('error');
                    setMessage(`${health.issueCount} violation${health.issueCount > 1 ? 's' : ''}`);
                    setIssueCount(health.issueCount);
                }
            } catch (error) {
                console.error('Error checking canon health:', error);
                setStatus('ok');
                setMessage('Unable to check');
            }
        }

        checkCanonHealth();
    }, [projectId]);

    const statusConfig = {
        loading: {
            icon: Loader2,
            variant: 'secondary' as const,
            label: 'Checking...',
            className: 'animate-spin',
        },
        ok: {
            icon: CheckCircle2,
            variant: 'secondary' as const,
            label: 'Canon OK',
            className: 'text-green-600',
        },
        warning: {
            icon: AlertTriangle,
            variant: 'outline' as const,
            label: `${issueCount} Warning${issueCount > 1 ? 's' : ''}`,
            className: 'text-yellow-600',
        },
        error: {
            icon: XCircle,
            variant: 'destructive' as const,
            label: `${issueCount} Error${issueCount > 1 ? 's' : ''}`,
            className: 'text-red-600',
        },
    };

    const config = statusConfig[status];
    const Icon = config.icon;

    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Badge variant={config.variant} className={`gap-1 cursor-help ${className ?? ''}`}>
                        <Icon className={`h-3 w-3 ${config.className}`} />
                        <span className="text-xs">{config.label}</span>
                    </Badge>
                </TooltipTrigger>
                <TooltipContent>
                    <p className="text-sm">{message}</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}
