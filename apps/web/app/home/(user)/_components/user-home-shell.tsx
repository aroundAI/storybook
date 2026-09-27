import { use } from 'react';

import { cookies } from 'next/headers';

import { z } from 'zod';

import { UserWorkspaceContextProvider } from '@kit/accounts/components';
import { Page, PageMobileNavigation, PageNavigation } from '@kit/ui/page';
import { SidebarProvider } from '@kit/ui/shadcn-sidebar';

import { AppLogo } from '~/components/app-logo';
import { personalAccountNavigationConfig } from '~/config/personal-account-navigation.config';

import { loadUserWorkspace } from '../_lib/server/load-user-workspace';
import { HomeMenuNavigation } from './home-menu-navigation';
import { HomeMobileNavigation } from './home-mobile-navigation';
import { HomeSidebar } from './home-sidebar';

/**
 * The signed-in user's own chrome (sidebar or header, their workspace
 * context). Shared by the `(user)` pages and by profile settings, which must
 * stay reachable when personal accounts are off (KB-100).
 */
export function UserHomeShell({ children }: React.PropsWithChildren) {
  const state = use(getLayoutState());

  if (state.style === 'sidebar') {
    return <SidebarLayout>{children}</SidebarLayout>;
  }

  return <HeaderLayout>{children}</HeaderLayout>;
}

function SidebarLayout({ children }: React.PropsWithChildren) {
  const workspace = use(loadUserWorkspace());
  const state = use(getLayoutState());

  return (
    <UserWorkspaceContextProvider value={workspace}>
      <SidebarProvider defaultOpen={state.open}>
        <Page style={'sidebar'}>
          <PageNavigation>
            <HomeSidebar workspace={workspace} />
          </PageNavigation>

          <PageMobileNavigation className={'flex items-center justify-between'}>
            <MobileNavigation workspace={workspace} />
          </PageMobileNavigation>

          {children}
        </Page>
      </SidebarProvider>
    </UserWorkspaceContextProvider>
  );
}

function HeaderLayout({ children }: React.PropsWithChildren) {
  const workspace = use(loadUserWorkspace());

  return (
    <UserWorkspaceContextProvider value={workspace}>
      <Page style={'header'}>
        <PageNavigation>
          <HomeMenuNavigation workspace={workspace} />
        </PageNavigation>

        <PageMobileNavigation className={'flex items-center justify-between'}>
          <MobileNavigation workspace={workspace} />
        </PageMobileNavigation>

        {children}
      </Page>
    </UserWorkspaceContextProvider>
  );
}

function MobileNavigation({
  workspace,
}: {
  workspace: Awaited<ReturnType<typeof loadUserWorkspace>>;
}) {
  return (
    <>
      <AppLogo />

      <HomeMobileNavigation workspace={workspace} />
    </>
  );
}

async function getLayoutState() {
  const cookieStore = await cookies();

  const LayoutStyleSchema = z.enum(['sidebar', 'header', 'custom']);

  const layoutStyleCookie = cookieStore.get('layout-style');
  const sidebarOpenCookie = cookieStore.get('sidebar:state');

  const sidebarOpen = sidebarOpenCookie
    ? sidebarOpenCookie.value === 'false'
    : !personalAccountNavigationConfig.sidebarCollapsed;

  const parsedStyle = LayoutStyleSchema.safeParse(layoutStyleCookie?.value);

  const style = parsedStyle.success
    ? parsedStyle.data
    : personalAccountNavigationConfig.style;

  return {
    open: sidebarOpen,
    style,
  };
}
