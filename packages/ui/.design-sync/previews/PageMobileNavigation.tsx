import { Home, Mic2, Settings, Sparkles } from 'lucide-react';

import {
  Page,
  PageBody,
  PageMobileNavigation,
  PageNavigation,
} from '@kit/ui/page';
import { SidebarProvider } from '@kit/ui/shadcn-sidebar';

// The default (sidebar) Page style reads PageNavigation as its desktop
// nav slot and PageMobileNavigation as its mobile top bar slot — both are
// matched by element type in page.tsx's getSlotsFromPage, so they must be
// direct children of Page (not nested deeper) to be picked up.
export function Default() {
  const navItems = [
    { label: 'Overview', icon: Home },
    { label: 'Audio Studio', icon: Mic2 },
    { label: 'Visual Studio', icon: Sparkles },
    { label: 'Settings', icon: Settings },
  ];

  return (
    <div className="bg-background h-[420px] overflow-hidden rounded-lg border">
      <SidebarProvider>
        <Page>
          <PageNavigation>
            <nav className="flex h-full w-56 flex-col gap-1 border-r p-3">
              {navItems.map(({ label, icon: Icon }) => (
                <div
                  key={label}
                  className="text-muted-foreground hover:bg-muted hover:text-foreground flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </div>
              ))}
            </nav>
          </PageNavigation>

          <PageMobileNavigation className="lg:hidden">
            <span className="text-sm font-semibold">Midnight Frequency</span>
          </PageMobileNavigation>

          <PageBody>
            <div className="p-6">
              <h2 className="text-lg font-semibold">Episode 4: Static</h2>
              <p className="text-muted-foreground text-sm">
                Visual Studio · 12 shots generated
              </p>
            </div>
          </PageBody>
        </Page>
      </SidebarProvider>
    </div>
  );
}
