import { UpsertSubscriptionParams } from '@kit/billing/types';

type SubscriptionStatus =
  | 'on_trial'
  | 'active'
  | 'cancelled'
  | 'paused'
  | 'expired'
  | 'unpaid'
  | 'past_due';

/**
 * @name createLemonSqueezySubscriptionPayloadBuilderService
 * @description Create a new instance of the `LemonSqueezySubscriptionPayloadBuilderService` class
 */
export function createLemonSqueezySubscriptionPayloadBuilderService() {
  return new LemonSqueezySubscriptionPayloadBuilderService();
}

/**
 * @name LemonSqueezySubscriptionPayloadBuilderService
 * @description This class is used to build the subscription payload for Lemon Squeezy
 */
class LemonSqueezySubscriptionPayloadBuilderService {
  /**
   * @name build
   * @description Build the subscription payload for Lemon Squeezy
   * @param params
   */
  build<
    LineItem extends {
      id: string;
      quantity: number;
      product: string;
      variant: string;
      priceAmount: number;
      type: 'flat' | 'per_seat' | 'metered';
    },
  >(params: {
    id: string;
    accountId: string;
    customerId: string;
    lineItems: LineItem[];
    interval: string;
    intervalCount: number;
    status: string;
    currency: string;
    cancelAtPeriodEnd: boolean;
    periodStartsAt: number;
    periodEndsAt: number;
    trialStartsAt: number | null;
    trialEndsAt: number | null;
  }): UpsertSubscriptionParams {
    const canceledAtPeriodEnd =
      params.status === 'cancelled' && params.cancelAtPeriodEnd;

    const active =
      params.status === 'active' ||
      params.status === 'trialing' ||
      canceledAtPeriodEnd;

    const lineItems = params.lineItems.map((item) => {
      const quantity = item.quantity ?? 1;

      return {
        id: item.id,
        subscription_item_id: item.id,
        quantity,
        interval: params.interval,
        interval_count: params.intervalCount,
        subscription_id: params.id,
        product_id: item.product,
        variant_id: item.variant,
        price_amount: item.priceAmount,
        type: item.type,
      };
    });

    // otherwise we are updating a subscription
    // and we only need to return the update payload
    return {
      target_subscription_id: params.id,
      target_account_id: params.accountId,
      target_customer_id: params.customerId,
      billing_provider: 'lemon-squeezy',
      status: this.getSubscriptionStatus(params.status as SubscriptionStatus),
      line_items: lineItems,
      active,
      currency: params.currency,
      cancel_at_period_end: params.cancelAtPeriodEnd ?? false,
      period_starts_at: getISOString(params.periodStartsAt) as string,
      period_ends_at: getISOString(params.periodEndsAt) as string,
      trial_starts_at: params.trialStartsAt
        ? getISOString(params.trialStartsAt)
        : undefined,
      trial_ends_at: params.trialEndsAt
        ? getISOString(params.trialEndsAt)
        : undefined,
    };
  }

  private getSubscriptionStatus(status: SubscriptionStatus) {
    const statusMap = {
      active: 'active',
      cancelled: 'canceled',
      paused: 'paused',
      on_trial: 'trialing',
      past_due: 'past_due',
      unpaid: 'unpaid',
      expired: 'past_due',
    } satisfies Record<SubscriptionStatus, UpsertSubscriptionParams['status']>;

    // Default to 'active' if status is unknown
    return statusMap[status] || 'active';
  }
}

function getISOString(date: number | null) {
  return date ? new Date(date).toISOString() : undefined;
}
