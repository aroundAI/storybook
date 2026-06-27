import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  navigationMenuTriggerStyle,
} from '@kit/ui/navigation-menu';

export function Default() {
  return (
    <NavigationMenu>
      <NavigationMenuList className="gap-x-2.5">
        <NavigationMenuItem>
          <NavigationMenuLink
            href="/home"
            className={navigationMenuTriggerStyle()}
          >
            Studio
          </NavigationMenuLink>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <NavigationMenuLink
            href="/pricing"
            className={navigationMenuTriggerStyle()}
          >
            Pricing
          </NavigationMenuLink>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <NavigationMenuLink
            href="/docs"
            className={navigationMenuTriggerStyle()}
          >
            Docs
          </NavigationMenuLink>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  );
}
