import { ExclamationTriangleIcon } from '@radix-ui/react-icons';
import { z } from 'zod';

import { PlanSchema, ProductSchema } from '@kit/billing';
import { resolveProductPlan } from '@kit/billing-gateway';
import {
  BillingPortalCard,
  CurrentLifetimeOrderCard,
  CurrentSubscriptionCard,
} from '@kit/billing-gateway/components';
import { Alert, AlertDescription, AlertTitle } from '@kit/ui/alert';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { If } from '@kit/ui/if';
import { PageBody } from '@kit/ui/page';
import { Trans } from '@kit/ui/trans';
import { cn } from '@kit/ui/utils';

import billingConfig from '~/config/billing.config';
import { createI18nServerInstance } from '~/lib/i18n/i18n.server';
import { withI18n } from '~/lib/i18n/with-i18n';

// local imports
import { TeamAccountLayoutPageHeader } from '../_components/team-account-layout-page-header';
import { loadTeamAccountBillingPage } from '../_lib/server/team-account-billing-page.loader';
import { loadTeamWorkspace } from '../_lib/server/team-account-workspace.loader';
import { TeamAccountCheckoutForm } from './_components/team-account-checkout-form';
import { createBillingPortalSession } from './_lib/server/server-actions';

interface TeamAccountBillingPageProps {
  params: Promise<{ account: string }>;
}

export const generateMetadata = async () => {
  const i18n = await createI18nServerInstance();
  const title = i18n.t('teams:billing.pageTitle');

  return {
    title,
  };
};

async function TeamAccountBillingPage({ params }: TeamAccountBillingPageProps) {
  const account = (await params).account;
  const workspace = await loadTeamWorkspace(account);
  const accountId = workspace.account.id;

  const [subscription, order, customerId] =
    await loadTeamAccountBillingPage(accountId);

  const subscriptionProductPlan = subscription
    ? await getProductPlan(
        subscription.items[0]?.variant_id,
        subscription.currency,
      )
    : undefined;

  const orderProductPlan = order
    ? await getProductPlan(order.items[0]?.variant_id, order.currency)
    : undefined;

  const hasBillingData = subscription || order;

  const canManageBilling =
    workspace.account.permissions.includes('billing.manage');

  const Checkout = () => {
    if (!canManageBilling) {
      return <CannotManageBillingAlert />;
    }

    return (
      <TeamAccountCheckoutForm customerId={customerId} accountId={accountId} />
    );
  };

  const BillingPortal = () => {
    if (!canManageBilling || !customerId) {
      return null;
    }

    return (
      <form action={createBillingPortalSession}>
        <input type="hidden" name={'accountId'} value={accountId} />
        <input type="hidden" name={'slug'} value={account} />

        <BillingPortalCard />
      </form>
    );
  };

  return (
    <>
      <TeamAccountLayoutPageHeader
        account={account}
        title={<Trans i18nKey={'common:routes.billing'} />}
        description={<AppBreadcrumbs />}
      />

      <PageBody>
        <div
          className={cn(`flex w-full flex-col space-y-4`, {
            'max-w-2xl': hasBillingData,
          })}
        >
          <If condition={!hasBillingData}>
            <Checkout />
          </If>

          <If condition={subscription}>
            {(subscription) => {
              return (
                <CurrentSubscriptionCard
                  subscription={subscription}
                  product={subscriptionProductPlan!.product}
                  plan={subscriptionProductPlan!.plan}
                />
              );
            }}
          </If>

          <If condition={order}>
            {(order) => {
              return (
                <CurrentLifetimeOrderCard
                  order={order}
                  product={orderProductPlan!.product}
                  plan={orderProductPlan!.plan}
                />
              );
            }}
          </If>

          <BillingPortal />
        </div>
      </PageBody>
    </>
  );
}

export default withI18n(TeamAccountBillingPage);

function CannotManageBillingAlert() {
  return (
    <Alert variant={'warning'}>
      <ExclamationTriangleIcon className={'h-4'} />

      <AlertTitle>
        <Trans i18nKey={'billing:cannotManageBillingAlertTitle'} />
      </AlertTitle>

      <AlertDescription>
        <Trans i18nKey={'billing:cannotManageBillingAlertDescription'} />
      </AlertDescription>
    </Alert>
  );
}

async function getProductPlan(
  variantId: string | undefined,
  currency: string,
): Promise<
  | {
      product: ProductSchema;
      plan: z.infer<typeof PlanSchema>;
    }
  | undefined
> {
  if (!variantId) {
    return undefined;
  }

  return resolveProductPlan(billingConfig, variantId, currency);
}
