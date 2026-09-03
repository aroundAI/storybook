import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from '@kit/ui/navigation-menu';

export function Default() {
  return (
    <NavigationMenu defaultValue="resources">
      <NavigationMenuList className="gap-x-2.5">
        <NavigationMenuItem value="resources">
          <NavigationMenuTrigger>Resources</NavigationMenuTrigger>
          <NavigationMenuContent>
            <ul className="grid w-[320px] gap-2 p-4">
              <li>
                <NavigationMenuLink
                  href="/docs"
                  className="hover:bg-accent block rounded-md p-2 text-sm"
                >
                  <div className="font-medium">Documentation</div>
                  <p className="text-muted-foreground text-xs">
                    Guides for the episode generation pipeline.
                  </p>
                </NavigationMenuLink>
              </li>
              <li>
                <NavigationMenuLink
                  href="/changelog"
                  className="hover:bg-accent block rounded-md p-2 text-sm"
                >
                  <div className="font-medium">Changelog</div>
                  <p className="text-muted-foreground text-xs">
                    See what shipped in the latest release.
                  </p>
                </NavigationMenuLink>
              </li>
            </ul>
          </NavigationMenuContent>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  );
}
