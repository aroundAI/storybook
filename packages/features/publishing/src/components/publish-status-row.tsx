'use client';

import {
  CheckCircle,
  Clock,
  ExternalLink,
  Loader2,
  XCircle,
} from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';

import type { PublishResult } from '../lib/types';

interface PublishStatusRowProps {
  result: PublishResult;
  onRetry?: () => void;
}

export function PublishStatusRow({ result, onRetry }: PublishStatusRowProps) {
  const icons = {
    pending: <Clock className="text-muted-foreground h-4 w-4" />,
    publishing: <Loader2 className="h-4 w-4 animate-spin text-blue-500" />,
    completed: <CheckCircle className="h-4 w-4 text-green-500" />,
    failed: <XCircle className="h-4 w-4 text-red-500" />,
    scheduled: <Clock className="h-4 w-4 text-amber-500" />,
  };

  const badgeVariants = {
    pending: 'secondary' as const,
    publishing: 'secondary' as const,
    completed: 'default' as const,
    failed: 'destructive' as const,
    scheduled: 'secondary' as const,
  };

  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <div className="flex items-center gap-3">
        {icons[result.status]}
        <span className="font-medium capitalize">{result.platform}</span>
        <Badge variant={badgeVariants[result.status]}>{result.status}</Badge>
      </div>

      <div className="flex items-center gap-2">
        {result.platformUrl && (
          <Button variant="ghost" size="sm" asChild>
            <a
              href={result.platformUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              View <ExternalLink className="ml-1 h-3 w-3" />
            </a>
          </Button>
        )}
        {result.status === 'failed' && onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        )}
        {result.error && (
          <span className="text-destructive max-w-[200px] truncate text-sm">
            {result.error}
          </span>
        )}
      </div>
    </div>
  );
}
