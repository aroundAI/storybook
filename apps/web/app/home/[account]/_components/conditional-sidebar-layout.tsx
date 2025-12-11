'use client';

import { usePathname } from 'next/navigation';

import { Page, PageMobileNavigation, PageNavigation } from '@kit/ui/page';
import type { JWTUserData } from '@kit/supabase/types';

import { AppLogo } from '~/components/app-logo';

import { TeamAccountLayoutMobileNavigation } from './team-account-layout-mobile-navigation';
import { TeamAccountLayoutSidebar } from './team-account-layout-sidebar';

interface ConditionalSidebarLayoutProps {
    children: React.ReactNode;
    account: string;
    accounts: Array<{
        label: string | null;
        value: string | null;
    }>;
    user: JWTUserData;
    accountId: string;
}

/**
 * Conditionally renders sidebar based on current route.
 * Hides main sidebar when in Studio project view to avoid double sidebar.
 */
export function ConditionalSidebarLayout({
    children,
    account,
    accounts,
    user,
    accountId,
}: ConditionalSidebarLayoutProps) {
    const pathname = usePathname();

    // Hide main sidebar when in Studio project routes
    // Pattern: /home/{account}/studio/{projectId} or /home/{account}/studio/{projectId}/*
    // We detect this by checking if there's a project ID (UUID or any text) after /studio/
    const studioPath = `/home/${account}/studio/`;
    const isStudioProject =
        pathname.startsWith(studioPath) &&
        pathname.length > studioPath.length; // Has content after /studio/


    return (
        <Page style={'sidebar'}>
            {!isStudioProject && (
                <PageNavigation>
                    <TeamAccountLayoutSidebar
                        account={account}
                        accountId={accountId}
                        accounts={accounts}
                        user={user}
                    />
                </PageNavigation>
            )}

            <PageMobileNavigation className={'flex items-center justify-between'}>
                <AppLogo />

                <div className={'flex space-x-4'}>
                    <TeamAccountLayoutMobileNavigation
                        userId={user.id}
                        accounts={accounts}
                        account={account}
                    />
                </div>
            </PageMobileNavigation>

            {children}
        </Page>
    );
}
