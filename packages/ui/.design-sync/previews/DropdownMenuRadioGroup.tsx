import { ArrowDownUp } from 'lucide-react';

import { Button } from '@kit/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';

export function Default() {
  return (
    <DropdownMenu open>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <ArrowDownUp className="mr-2 h-4 w-4" />
          Sort by
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" forceMount>
        <DropdownMenuLabel>Sort episodes by</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value="updated">
          <DropdownMenuRadioItem value="updated">
            Last updated
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="created">
            Date created
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="title">
            Title (A–Z)
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
