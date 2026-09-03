import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@kit/ui/tooltip';

export function Default() {
  return (
    <TooltipProvider>
      <Tooltip open>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="cursor-help gap-1">
            <CheckCircle2 className="h-3 w-3 text-green-500" />
            <span className="text-xs">Canon healthy</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-sm">
            No contradictions detected against established character facts.
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function Warning() {
  return (
    <TooltipProvider>
      <Tooltip open>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="cursor-help gap-1">
            <AlertTriangle className="h-3 w-3 text-amber-500" />
            <span className="text-xs">2 canon conflicts</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p className="text-sm">
            Episode 5 contradicts Mara&apos;s established eye color from Episode
            1.
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
