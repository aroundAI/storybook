import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';
import { SubMenuModeToggle } from '@kit/ui/mode-toggle';

// SubMenuModeToggle is a zero-prop structural subpart: it reads theme from
// next-themes context and renders a DropdownMenuSub (desktop) +
// DropdownMenuLabel/items (mobile) pair meant to be nested inside an
// account dropdown's DropdownMenuContent, e.g. personal-account-dropdown.tsx.
export function Default() {
  return (
    <DropdownMenu open>
      <DropdownMenuTrigger asChild>
        <button className="text-sm">Account</button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <SubMenuModeToggle />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
