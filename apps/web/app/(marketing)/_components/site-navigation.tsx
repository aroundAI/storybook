import { Menu } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';
import { NavigationMenu, NavigationMenuList } from '@kit/ui/navigation-menu';

// Navigation links disabled for invite-only launch
// To add links back, define them here and they will automatically appear

export function SiteNavigation() {
  return (
    <>
      <div className={'hidden items-center justify-center md:flex'}>
        <NavigationMenu>
          <NavigationMenuList className={'gap-x-2.5'}>
            {/* Navigation items will go here when ready */}
          </NavigationMenuList>
        </NavigationMenu>
      </div>

      <div className={'flex justify-start sm:items-center md:hidden'}>
        <MobileDropdown />
      </div>
    </>
  );
}

function MobileDropdown() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={'Open Menu'}>
        <Menu className={'h-8 w-8'} />
      </DropdownMenuTrigger>

      <DropdownMenuContent className={'w-full'}>
        {/* Mobile navigation items will go here when ready */}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
