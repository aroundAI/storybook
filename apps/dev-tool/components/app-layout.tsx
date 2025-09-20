import { DevToolSidebar } from '@/components/app-sidebar';

import { SidebarInset, SidebarProvider } from '@kit/ui/shadcn-sidebar';

export function DevToolLayout(props: React.PropsWithChildren) {
  return (
    <SidebarProvider>
      <DevToolSidebar />

      <SidebarInset>{props.children}</SidebarInset>
    </SidebarProvider>
  );
}
