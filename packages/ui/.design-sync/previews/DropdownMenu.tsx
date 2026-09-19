import { Copy, Download, MoreVertical, RotateCcw, Trash2 } from 'lucide-react';

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
        <DropdownMenuItem>
          <Download className="mr-2 h-4 w-4" />
          Export Screenplay
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive">
          <Trash2 className="mr-2 h-4 w-4" />
          Delete Episode
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function WithSubmenu() {
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
              <span className="ml-auto text-xs text-muted-foreground">
                Clears screenplay, shots
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem>
              Reset to Screenplay
              <span className="ml-auto text-xs text-muted-foreground">
                Clears shots, audio
              </span>
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
