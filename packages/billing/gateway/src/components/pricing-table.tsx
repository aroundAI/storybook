'use client';

import { useState } from 'react';

import Link from 'next/link';

import { ArrowRight, CheckCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import {
  BillingConfig,
  type LineItemSchema,
  getPlanIntervals,
  getPrimaryLineItem,
} from '@kit/billing';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { If } from '@kit/ui/if';
import { Trans } from '@kit/ui/trans';
import { cn } from '@kit/ui/utils';

import { LineItemDetails } from './line-item-details';
import { PlanCostDisplay } from './plan-cost-display';

interface Paths {
  signUp: string;
  return: string;
}

type Interval = 'month' | 'year';

export function PricingTable({
  config,
  paths,
  CheckoutButtonRenderer,
  redirectToCheckout = true,
  displayPlanDetails = true,
  alwaysDisplayMonthlyPrice = true,
}: {
  config: BillingConfig;
  paths: Paths;
  displayPlanDetails?: boolean;
  alwaysDisplayMonthlyPrice?: boolean;
  redirectToCheckout?: boolean;

  CheckoutButtonRenderer?: React.ComponentType<{
    planId: string;
    productId: string;
    highlighted?: boolean;
  }>;
}) {
  const intervals = getPlanIntervals(config).filter(Boolean) as Interval[];
  const [interval, setInterval] = useState(intervals[0]!);

  // Always filter out hidden products
  const visibleProducts = config.products.filter((product) => !product.hidden);

  return (
    <div className={'flex flex-col space-y-8 xl:space-y-12'}>
      <div className={'flex justify-center'}>
        {intervals.length > 1 ? (
          <PlanIntervalSwitcher
            intervals={intervals}
            interval={interval}
            setInterval={setInterval}
          />
        ) : null}
      </div>

      <div
        className={
          'flex flex-col items-start space-y-6 lg:space-y-0' +
          ' justify-center lg:flex-row lg:space-x-4'
        }
      >
        {visibleProducts.map((product) => {
          const plan = product.plans.find((plan) => {
            if (plan.paymentType === 'recurring') {
              return plan.interval === interval;
            }

            return plan;
          });

          if (!plan) {
            return null;
          }

          const primaryLineItem = getPrimaryLineItem(config, plan.id);

          if (!plan.custom && !primaryLineItem) {
            throw new Error(`Primary line item not found for plan ${plan.id}`);
          }

          return (
            <PricingItem
              selectable
              key={plan.id}
              plan={plan}
              redirectToCheckout={redirectToCheckout}
              primaryLineItem={primaryLineItem}
              product={product}
              paths={paths}
              displayPlanDetails={displayPlanDetails}
              alwaysDisplayMonthlyPrice={alwaysDisplayMonthlyPrice}
              CheckoutButton={CheckoutButtonRenderer}
            />
          );
        })}
      </div>
    </div>
  );
}

function PricingItem(
  props: React.PropsWithChildren<{
    className?: string;
    displayPlanDetails: boolean;

    paths: Paths;

    selectable: boolean;

    primaryLineItem: z.infer<typeof LineItemSchema> | undefined;

    redirectToCheckout?: boolean;
    alwaysDisplayMonthlyPrice?: boolean;

    plan: {
      id: string;
      lineItems: z.infer<typeof LineItemSchema>[];
      interval?: Interval;
      name?: string;
      href?: string;
      label?: string;
      custom?: boolean;
    };

    CheckoutButton?: React.ComponentType<{
      planId: string;
      productId: string;
      highlighted?: boolean;
    }>;

    product: {
      id: string;
      name: string;
      currency: string;
      description: string;
      badge?: string;
      highlighted?: boolean;
      features: string[];
    };
  }>,
) {
  const highlighted = props.product.highlighted ?? false;
  const lineItem = props.primaryLineItem!;
  const isCustom = props.plan.custom ?? false;

  // we exclude flat line items from the details since
  // it doesn't need further explanation
  const lineItemsToDisplay = props.plan.lineItems.filter((item) => {
    return item.type !== 'flat';
  });

  const interval = props.plan.interval as Interval;

  return (
    <div
      data-cy={'subscription-plan'}
      className={cn(
        props.className,
        `s-full relative flex flex-1 grow flex-col items-stretch justify-between self-stretch rounded-lg border px-6 py-5 lg:w-4/12 xl:max-w-[20rem]`,
        {
          ['border-primary']: highlighted,
          ['border-border']: !highlighted,
        },
      )}
    >
      <If condition={props.product.badge}>
        <div className={'absolute -top-2.5 left-0 flex w-full justify-center'}>
          <Badge
            className={highlighted ? '' : 'bg-background'}
            variant={highlighted ? 'default' : 'outline'}
          >
            <span>
              <Trans
                i18nKey={props.product.badge}
                defaults={props.product.badge}
              />
            </span>
          </Badge>
        </div>
      </If>

      <div className={'flex flex-col gap-y-5'}>
        <div className={'flex flex-col gap-y-1'}>
          <div className={'flex items-center space-x-6'}>
            <b
              className={
                'text-secondary-foreground font-heading text-xl font-medium tracking-tight'
              }
            >
              <Trans
                i18nKey={props.product.name}
                defaults={props.product.name}
              />
            </b>
          </div>
        </div>

        <div className={'mt-6 flex flex-col gap-y-1'}>
          <Price
            isMonthlyPrice={props.alwaysDisplayMonthlyPrice}
            displayBillingPeriod={!props.plan.label}
          >
            <If
              condition={!isCustom}
              fallback={
                <Trans i18nKey={props.plan.label} defaults={props.plan.label} />
              }
            >
              <PlanCostDisplay
                primaryLineItem={lineItem}
                currencyCode={props.product.currency}
                interval={interval}
                alwaysDisplayMonthlyPrice={props.alwaysDisplayMonthlyPrice}
              />
            </If>
          </Price>

          <If condition={props.plan.name}>
            <span
              className={cn(
                `animate-in slide-in-from-left-4 fade-in text-muted-foreground flex items-center gap-x-1 text-xs capitalize`,
              )}
            >
              <span>
                <If
                  condition={props.plan.interval}
                  fallback={<Trans i18nKey={'billing:lifetime'} />}
                >
                  {(interval) => (
                    <Trans i18nKey={`billing:billingInterval.${interval}`} />
                  )}
                </If>
              </span>

              <If condition={lineItem && lineItem?.type !== 'flat'}>
                <span>/</span>

                <span
                  className={cn(
                    `animate-in slide-in-from-left-4 fade-in text-sm capitalize`,
                  )}
                >
                  <If condition={lineItem?.type === 'per_seat'}>
                    <Trans i18nKey={'billing:perTeamMember'} />
                  </If>

                  <If condition={lineItem?.unit}>
                    <Trans
                      i18nKey={'billing:perUnit'}
                      values={{
                        unit: lineItem?.unit,
                      }}
                    />
                  </If>
                </span>
              </If>
            </span>
          </If>
        </div>

        <If condition={props.selectable}>
          <If
            condition={props.plan.id && props.CheckoutButton}
            fallback={
              <DefaultCheckoutButton
                paths={props.paths}
                product={props.product}
                highlighted={highlighted}
                plan={props.plan}
                redirectToCheckout={props.redirectToCheckout}
              />
            }
          >
            {(CheckoutButton) => (
              <CheckoutButton
                highlighted={highlighted}
                planId={props.plan.id}
                productId={props.product.id}
              />
            )}
          </If>
        </If>

        <span className={cn(`text-muted-foreground text-base tracking-tight`)}>
          <Trans
            i18nKey={props.product.description}
            defaults={props.product.description}
          />
        </span>

        <div className={'h-px w-full border border-dashed'} />

        <div className={'flex flex-col'}>
          <FeaturesList
            highlighted={highlighted}
            features={props.product.features}
          />
        </div>

        <If condition={props.displayPlanDetails && lineItemsToDisplay.length}>
          <div className={'h-px w-full border border-dashed'} />

          <div className={'flex flex-col space-y-2'}>
            <h6 className={'text-sm font-semibold'}>
              <Trans i18nKey={'billing:detailsLabel'} />
            </h6>

            <LineItemDetails
              selectedInterval={props.plan.interval}
              currency={props.product.currency}
              lineItems={lineItemsToDisplay}
            />
          </div>
        </If>
      </div>
    </div>
  );
}

function FeaturesList(
  props: React.PropsWithChildren<{
    features: string[];
    highlighted: boolean;
  }>,
) {
  return (
    <ul className={'flex flex-col gap-1'}>
      {props.features.map((feature) => {
        return (
          <ListItem highlighted={props.highlighted} key={feature}>
            <Trans i18nKey={feature} defaults={feature} />
          </ListItem>
        );
      })}
    </ul>
  );
}

function Price({
  children,
  isMonthlyPrice = true,
  displayBillingPeriod = true,
}: React.PropsWithChildren<{
  isMonthlyPrice?: boolean;
  displayBillingPeriod?: boolean;
}>) {
  return (
    <div
      className={`animate-in slide-in-from-left-4 fade-in flex items-end gap-1 duration-500`}
    >
      <span
        className={
          'font-heading flex items-center text-4xl font-medium tracking-tighter'
        }
      >
        {children}
      </span>

      <If condition={isMonthlyPrice && displayBillingPeriod}>
        <span className={'text-muted-foreground text-sm leading-loose'}>
          <span>/</span>

          <Trans i18nKey={'billing:perMonth'} />
        </span>
      </If>
    </div>
  );
}

function ListItem({
  children,
  highlighted,
}: React.PropsWithChildren<{
  highlighted: boolean;
}>) {
  return (
    <li className={'flex items-center gap-x-2.5'}>
      <CheckCircle
        className={cn('h-4 min-h-4 w-4 min-w-4', {
          'text-secondary-foreground': highlighted,
          'text-muted-foreground': !highlighted,
        })}
      />

      <span
        className={cn('text-sm', {
          'text-muted-foreground': !highlighted,
          'text-secondary-foreground': highlighted,
        })}
      >
        {children}
      </span>
    </li>
  );
}

function PlanIntervalSwitcher(
  props: React.PropsWithChildren<{
    intervals: Interval[];
    interval: Interval;
    setInterval: (interval: Interval) => void;
  }>,
) {
  return (
    <div className={'flex gap-x-1 rounded-full border p-1.5'}>
      {props.intervals.map((plan, index) => {
        const selected = plan === props.interval;

        const className = cn(
          'animate-in fade-in !outline-hidden rounded-full transition-all focus:!ring-0',
          {
            'border-r-transparent': index === 0,
            ['hover:text-primary text-muted-foreground']: !selected,
            ['cursor-default font-semibold']: selected,
            ['hover:bg-initial']: !selected,
          },
        );

        return (
          <Button
            key={plan}
            size={'sm'}
            variant={selected ? 'default' : 'ghost'}
            className={className}
            onClick={() => props.setInterval(plan)}
          >
            <span className={'flex items-center'}>
              <CheckCircle
                className={cn('animate-in fade-in zoom-in-95 h-3.5', {
                  hidden: !selected,
                  'slide-in-from-left-4': index === 0,
                  'slide-in-from-right-4': index === props.intervals.length - 1,
                })}
              />

              <span className={'capitalize'}>
                <Trans i18nKey={`common:billingInterval.${plan}`} />
              </span>
            </span>
          </Button>
        );
      })}
    </div>
  );
}

function DefaultCheckoutButton(
  props: React.PropsWithChildren<{
    plan: {
      id: string;
      name?: string | undefined;
      href?: string;
      buttonLabel?: string;
    };

    product: {
      name: string;
    };

    paths: Paths;
    redirectToCheckout?: boolean;

    highlighted?: boolean;
  }>,
) {
  const { t } = useTranslation('billing');

  const signUpPath = props.paths.signUp;

  const searchParams = new URLSearchParams({
    next: props.paths.return,
    plan: props.plan.id,
    redirectToCheckout: props.redirectToCheckout ? 'true' : 'false',
  });

  const linkHref =
    props.plan.href ?? `${signUpPath}?${searchParams.toString()}`;

  const label = props.plan.buttonLabel ?? 'common:getStartedWithPlan';

  return (
    <Link className={'w-full'} href={linkHref}>
      <Button
        size={'lg'}
        className={'h-12 w-full rounded-lg'}
        variant={props.highlighted ? 'default' : 'secondary'}
      >
        <span className={'text-base font-medium tracking-tight'}>
          <Trans
            i18nKey={label}
            defaults={label}
            values={{
              plan: t(props.product.name, {
                defaultValue: props.product.name,
              }),
            }}
          />
        </span>

        <ArrowRight className={'ml-2 h-4'} />
      </Button>
    </Link>
  );
}
