import { formatDate } from 'date-fns';
import { BadgeCheck } from 'lucide-react';

import { PlanSchema, type ProductSchema } from '@kit/billing';
import { Tables } from '@kit/supabase/database';
import { Alert, AlertDescription, AlertTitle } from '@kit/ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { If } from '@kit/ui/if';
import { Trans } from '@kit/ui/trans';

import { CurrentPlanAlert } from './current-plan-alert';
import { CurrentPlanBadge } from './current-plan-badge';
import { LineItemDetails } from './line-item-details';

type Subscription = Tables<'subscriptions'>;
type LineItem = Tables<'subscription_items'>;

interface Props {
  subscription: Subscription & {
    items: LineItem[];
  };

  product: ProductSchema;
  plan: ReturnType<(typeof PlanSchema)['parse']>;
}

export function CurrentSubscriptionCard({
  subscription,
  product,
  plan,
}: React.PropsWithChildren<Props>) {
  const lineItems = subscription.items;
  const firstLineItem = lineItems[0];

  if (!firstLineItem) {
    throw new Error('No line items found in subscription');
  }

  const productLineItems = plan.lineItems;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans i18nKey="billing:planCardTitle" />
        </CardTitle>

        <CardDescription>
          <Trans i18nKey="billing:planCardDescription" />
        </CardDescription>
      </CardHeader>

      <CardContent className={'space-y-4 border-t pt-4 text-sm'}>
        <div className={'flex flex-col space-y-1'}>
          <div className={'flex items-center gap-x-3 text-lg font-semibold'}>
            <BadgeCheck
              className={
                's-6 fill-green-500 text-white dark:fill-white dark:text-black'
              }
            />

            <span data-test={'current-plan-card-product-name'}>
              <Trans i18nKey={product.name} defaults={product.name} />
            </span>

            <CurrentPlanBadge status={subscription.status} />
          </div>

          <div>
            <p className={'text-muted-foreground'}>
              <Trans
                i18nKey={product.description}
                defaults={product.description}
              />
            </p>
          </div>
        </div>

        {/*
         Only show the alert if the subscription requires action
          (e.g. trial ending soon, subscription canceled, etc.)
        */}
        <If condition={!subscription.active}>
          <div data-test={'current-plan-card-status-alert'}>
            <CurrentPlanAlert status={subscription.status} />
          </div>
        </If>

        <If condition={subscription.status === 'trialing'}>
          <div className="flex flex-col gap-y-1">
            <span className="font-semibold">
              <Trans i18nKey="billing:trialEndsOn" />
            </span>

            <div className={'text-muted-foreground'}>
              <span>
                {subscription.trial_ends_at
                  ? formatDate(subscription.trial_ends_at, 'P')
                  : ''}
              </span>
            </div>
          </div>
        </If>

        <If condition={subscription.cancel_at_period_end}>
          <Alert variant={'warning'}>
            <AlertTitle>
              <Trans i18nKey="billing:subscriptionCancelled" />
            </AlertTitle>

            <AlertDescription>
              <Trans i18nKey="billing:cancelSubscriptionDate" />:
              <span className={'ml-1'}>
                {formatDate(subscription.period_ends_at ?? '', 'P')}
              </span>
            </AlertDescription>
          </Alert>
        </If>

        <div className="flex flex-col gap-y-1">
          <span className="font-semibold">
            <Trans i18nKey="billing:detailsLabel" />
          </span>

          <LineItemDetails
            lineItems={productLineItems}
            currency={subscription.currency}
            selectedInterval={firstLineItem.interval}
          />
        </div>
      </CardContent>
    </Card>
  );
}
