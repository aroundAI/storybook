import { AlertTriangle, RefreshCw } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@kit/ui/popover';
import { Separator } from '@kit/ui/separator';

export function Default() {
  return (
    <Popover defaultOpen>
      <PopoverTrigger asChild>
        <button type="button" className="focus:outline-none">
          <Badge
            variant="outline"
            className="cursor-pointer gap-1 border-amber-300 text-amber-600 hover:shadow-md"
          >
            <AlertTriangle className="h-3 w-3 text-amber-500" />
            <span className="text-xs">3 issues detected</span>
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="bottom" className="w-[360px] p-0">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-semibold">Canon Health</span>
            <Badge
              variant="outline"
              className="border-amber-300 text-[10px] text-amber-600"
            >
              3 Warnings
            </Badge>
          </div>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
        <Separator />
        <div className="px-4 py-3">
          <p className="text-xs text-muted-foreground">
            Some narrative threads have gone stale — they haven&apos;t been
            progressed or resolved in several episodes.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
