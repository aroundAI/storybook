import { Button } from '@kit/ui/button';
import { PageBody, PageHeader, PageHeaderActions } from '@kit/ui/page';
import { SidebarProvider } from '@kit/ui/shadcn-sidebar';

// `Page` is a separate top-level layout shell (Navigation/MobileNavigation
// slots only — see PageNavigation.tsx) used at the route-layout level, NOT
// a wrapper around PageHeader/PageBody: getSlotsFromPage's reduce keeps a
// SINGLE non-Navigation "Children" slot, so nesting both PageHeader and
// PageBody inside <Page> silently drops whichever renders first (PageHeader
// here) — the later sibling just overwrites it. Real usage (e.g.
// apps/web's episode analytics page) renders PageHeader + PageBody as
// siblings with no <Page> wrapper at all, which is what this mirrors.
// PageHeader still renders a SidebarTrigger by default
// (ENABLE_SIDEBAR_TRIGGER), which needs SidebarProvider context regardless.
// SidebarProvider's own root div is `flex min-h-svh w-full` (a horizontal
// flex row sized to the full viewport, meant to hold a sidebar + page side
// by side) — as the direct parent here it lays PageHeader/PageBody out as
// row siblings instead of stacked, and forces full-viewport height inside
// the confined preview card. Overriding className (cn merges via
// tailwind-merge) to a plain vertical, unconstrained-height stack.
export function Default() {
  return (
    <div className="bg-background overflow-hidden rounded-lg border">
      <SidebarProvider className="min-h-0 flex-col">
        <PageHeader
          title="Analytics"
          description="Track your content performance across all platforms."
        >
          <PageHeaderActions>
            <Button variant="outline" size="sm">
              Export CSV
            </Button>
          </PageHeaderActions>
        </PageHeader>

        <PageBody>
          <div className="grid grid-cols-3 gap-4 py-4">
            <div className="rounded-md border p-4">
              <p className="text-muted-foreground text-xs">Total views</p>
              <p className="text-2xl font-semibold">128.4K</p>
            </div>
            <div className="rounded-md border p-4">
              <p className="text-muted-foreground text-xs">Watch time</p>
              <p className="text-2xl font-semibold">6,204 hrs</p>
            </div>
            <div className="rounded-md border p-4">
              <p className="text-muted-foreground text-xs">Episodes live</p>
              <p className="text-2xl font-semibold">14</p>
            </div>
          </div>
        </PageBody>
      </SidebarProvider>
    </div>
  );
}
