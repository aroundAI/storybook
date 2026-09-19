import { AlertTriangle } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@kit/ui/popover';

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
      <PopoverContent align="start" side="bottom" className="w-[320px]">
        <p className="text-xs text-muted-foreground">
          Some narrative threads have gone stale — they haven&apos;t been
          progressed or resolved in several episodes.
        </p>
      </PopoverContent>
    </Popover>
  );
}
