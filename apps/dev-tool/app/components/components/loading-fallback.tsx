import { Loader2 } from 'lucide-react';

interface LoadingFallbackProps {
  message?: string;
  className?: string;
}

export function LoadingFallback({
  message = 'Loading component...',
  className = 'flex items-center justify-center py-12',
}: LoadingFallbackProps) {
  return (
    <div className={className}>
      <div className="text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{message}</span>
      </div>
    </div>
  );
}
