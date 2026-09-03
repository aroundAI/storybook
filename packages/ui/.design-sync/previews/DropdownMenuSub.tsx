import { Copy, MoreVertical, RotateCcw } from 'lucide-react';

import { Button } from '@kit/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';

export function Default() {
  return (
    <DropdownMenu open>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon">
          <MoreVertical className="h-4 w-4" />
          <span className="sr-only">Episode actions</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" forceMount>
        <DropdownMenuItem>
          <Copy className="mr-2 h-4 w-4" />
          Duplicate Episode
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub open>
          <DropdownMenuSubTrigger className="text-amber-600 focus:text-amber-600">
            <RotateCcw className="mr-2 h-4 w-4" />
            Reset to...
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent forceMount>
            <DropdownMenuItem>
              Reset to Story
              <span className="text-muted-foreground ml-auto text-xs">
                Clears screenplay, shots
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem>
              Reset to Screenplay
              <span className="text-muted-foreground ml-auto text-xs">
                Clears shots, audio
              </span>
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
