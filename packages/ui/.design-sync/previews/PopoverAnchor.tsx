import { AlertTriangle } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from '@kit/ui/popover';

export function Default() {
  return (
    <Popover defaultOpen>
      <PopoverAnchor asChild>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-amber-300 text-amber-600">
            <AlertTriangle className="mr-1 h-3 w-3 text-amber-500" />3 issues
            detected
          </Badge>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground text-xs underline"
            >
              View details
            </button>
          </PopoverTrigger>
        </div>
      </PopoverAnchor>
      <PopoverContent align="start" side="bottom" className="w-[320px]">
        <p className="text-muted-foreground text-xs">
          The anchor pins the popover to the badge instead of the trigger link,
          so the panel stays aligned with the status indicator.
        </p>
      </PopoverContent>
    </Popover>
  );
}
