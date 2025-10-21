import type Stripe from 'stripe';
import { beforeEach, describe, expect, it } from 'vitest';

import { createStripeSubscriptionPayloadBuilderService } from '../src/services/stripe-subscription-payload-builder.service';

describe('StripeSubscriptionPayloadBuilderService', () => {
  let service: ReturnType<typeof createStripeSubscriptionPayloadBuilderService>;

  beforeEach(() => {
    service = createStripeSubscriptionPayloadBuilderService();
  });

  describe('build', () => {
    describe('basic subscription payload', () => {
      it('should build payload with single line item', () => {
        const result = service.build({
          id: 'sub_123',
          accountId: 'acc_123',
          customerId: 'cus_123',
          lineItems: [
            {
              id: 'si_123',
              quantity: 1,
              price: {
                id: 'price_123',
                product: 'prod_123',
                unit_amount: 1000,
                recurring: {
                  interval: 'month',
                  interval_count: 1,
                } as Stripe.Price.Recurring,
              } as Stripe.Price,
              type: 'flat' as const,
            },
          ],
          status: 'active',
          currency: 'usd',
          cancelAtPeriodEnd: false,
          periodStartsAt: 1640000000,
          periodEndsAt: 1642592000,
          trialStartsAt: null,
          trialEndsAt: null,
        });

        expect(result).toEqual({
          target_subscription_id: 'sub_123',
          target_account_id: 'acc_123',
          target_customer_id: 'cus_123',
          billing_provider: 'stripe',
          status: 'active',
          line_items: [
            {
              id: 'si_123',
              quantity: 1,
              subscription_id: 'sub_123',
              subscription_item_id: 'si_123',
              product_id: 'prod_123',
              variant_id: 'price_123',
              price_amount: 1000,
              interval: 'month',
              interval_count: 1,
              type: 'flat',
            },
          ],
          active: true,
          currency: 'usd',
          cancel_at_period_end: false,
          period_starts_at: '2021-12-20T11:33:20.000Z',
          period_ends_at: '2022-01-19T11:33:20.000Z',
          trial_starts_at: undefined,
          trial_ends_at: undefined,
        });
      });

      it('should build payload with multiple line items', () => {
        const result = service.build({
          id: 'sub_456',
          accountId: 'acc_456',
          customerId: 'cus_456',
          lineItems: [
            {
              id: 'si_1',
              quantity: 1,
              price: {
                id: 'price_1',
                product: 'prod_1',
                unit_amount: 1000,
                recurring: {
                  interval: 'month',
                  interval_count: 1,
                } as Stripe.Price.Recurring,
              } as Stripe.Price,
              type: 'flat' as const,
            },
            {
              id: 'si_2',
              quantity: 5,
              price: {
                id: 'price_2',
                product: 'prod_2',
                unit_amount: 500,
                recurring: {
                  interval: 'month',
                  interval_count: 1,
                } as Stripe.Price.Recurring,
              } as Stripe.Price,
              type: 'per_seat' as const,
            },
          ],
          status: 'active',
          currency: 'usd',
          cancelAtPeriodEnd: false,
          periodStartsAt: 1640000000,
          periodEndsAt: 1642592000,
          trialStartsAt: null,
          trialEndsAt: null,
        });

        expect(result.line_items).toHaveLength(2);
        expect(result.line_items[0]).toMatchObject({
          id: 'si_1',
          quantity: 1,
          type: 'flat',
        });
        expect(result.line_items[1]).toMatchObject({
          id: 'si_2',
          quantity: 5,
          type: 'per_seat',
        });
      });

      it('should default quantity to 1 when not provided', () => {
        const result = service.build({
          id: 'sub_789',
          accountId: 'acc_789',
          customerId: 'cus_789',
          lineItems: [
            {
              id: 'si_789',
              price: {
                id: 'price_789',
                product: 'prod_789',
                unit_amount: 2000,
                recurring: {
                  interval: 'year',
                  interval_count: 1,
                } as Stripe.Price.Recurring,
              } as Stripe.Price,
              type: 'flat' as const,
            },
          ],
          status: 'active',
          currency: 'usd',
          cancelAtPeriodEnd: false,
          periodStartsAt: 1640000000,
          periodEndsAt: 1642592000,
          trialStartsAt: null,
          trialEndsAt: null,
        });

        expect(result.line_items[0]?.quantity).toBe(1);
      });
    });

    describe('subscription status', () => {
      it('should set active to true for active status', () => {
        const result = service.build({
          id: 'sub_active',
          accountId: 'acc_123',
          customerId: 'cus_123',
          lineItems: [
            {
              id: 'si_123',
              quantity: 1,
              price: {
                id: 'price_123',
                product: 'prod_123',
              } as Stripe.Price,
              type: 'flat',
            },
          ],
          status: 'active',
          currency: 'usd',
          cancelAtPeriodEnd: false,
          periodStartsAt: 1640000000,
          periodEndsAt: 1642592000,
          trialStartsAt: null,
          trialEndsAt: null,
        });

        expect(result.status).toBe('active');
        expect(result.active).toBe(true);
      });

      it('should set active to true for trialing status', () => {
        const result = service.build({
          id: 'sub_trial',
          accountId: 'acc_123',
          customerId: 'cus_123',
          lineItems: [
            {
              id: 'si_123',
              quantity: 1,
              price: {
                id: 'price_123',
                product: 'prod_123',
              } as Stripe.Price,
              type: 'flat',
            },
          ],
          status: 'trialing',
          currency: 'usd',
          cancelAtPeriodEnd: false,
          periodStartsAt: 1640000000,
          periodEndsAt: 1642592000,
          trialStartsAt: 1640000000,
          trialEndsAt: 1641000000,
        });

        expect(result.status).toBe('trialing');
        expect(result.active).toBe(true);
      });

      it('should set active to false for canceled status', () => {
        const result = service.build({
          id: 'sub_canceled',
          accountId: 'acc_123',
          customerId: 'cus_123',
          lineItems: [],
          status: 'canceled',
          currency: 'usd',
          cancelAtPeriodEnd: true,
          periodStartsAt: 1640000000,
          periodEndsAt: 1642592000,
          trialStartsAt: null,
          trialEndsAt: null,
        });

        expect(result.status).toBe('canceled');
        expect(result.active).toBe(false);
      });

      it('should set active to false for incomplete status', () => {
        const result = service.build({
          id: 'sub_incomplete',
          accountId: 'acc_123',
          customerId: 'cus_123',
          lineItems: [],
          status: 'incomplete',
          currency: 'usd',
          cancelAtPeriodEnd: false,
          periodStartsAt: 1640000000,
          periodEndsAt: 1642592000,
          trialStartsAt: null,
          trialEndsAt: null,
        });

        expect(result.status).toBe('incomplete');
        expect(result.active).toBe(false);
      });

      it('should set active to false for past_due status', () => {
        const result = service.build({
          id: 'sub_past_due',
          accountId: 'acc_123',
          customerId: 'cus_123',
          lineItems: [],
          status: 'past_due',
          currency: 'usd',
          cancelAtPeriodEnd: false,
          periodStartsAt: 1640000000,
          periodEndsAt: 1642592000,
          trialStartsAt: null,
          trialEndsAt: null,
        });

        expect(result.status).toBe('past_due');
        expect(result.active).toBe(false);
      });

      it('should set active to false for unpaid status', () => {
        const result = service.build({
          id: 'sub_unpaid',
          accountId: 'acc_123',
          customerId: 'cus_123',
          lineItems: [],
          status: 'unpaid',
          currency: 'usd',
          cancelAtPeriodEnd: false,
          periodStartsAt: 1640000000,
          periodEndsAt: 1642592000,
          trialStartsAt: null,
          trialEndsAt: null,
        });

        expect(result.status).toBe('unpaid');
        expect(result.active).toBe(false);
      });
    });

    describe('line item types', () => {
      it('should handle flat pricing type', () => {
        const result = service.build({
          id: 'sub_flat',
          accountId: 'acc_123',
          customerId: 'cus_123',
          lineItems: [
            {
              id: 'si_flat',
              quantity: 1,
              price: {
                id: 'price_flat',
                product: 'prod_flat',
                unit_amount: 999,
                recurring: {
                  interval: 'month',
                  interval_count: 1,
                } as Stripe.Price.Recurring,
              } as Stripe.Price,
              type: 'flat',
            },
          ],
          status: 'active',
          currency: 'usd',
          cancelAtPeriodEnd: false,
          periodStartsAt: 1640000000,
          periodEndsAt: 1642592000,
          trialStartsAt: null,
          trialEndsAt: null,
        });

        expect(result.line_items[0]?.type).toBe('flat');
        expect(result.line_items[0]?.quantity).toBe(1);
      });

      it('should handle per_seat pricing type', () => {
        const result = service.build({
          id: 'sub_per_seat',
          accountId: 'acc_123',
          customerId: 'cus_123',
          lineItems: [
            {
              id: 'si_per_seat',
              quantity: 10,
              price: {
                id: 'price_per_seat',
                product: 'prod_per_seat',
                unit_amount: 500,
                recurring: {
                  interval: 'month',
                  interval_count: 1,
                } as Stripe.Price.Recurring,
              } as Stripe.Price,
              type: 'per_seat',
            },
          ],
          status: 'active',
          currency: 'usd',
          cancelAtPeriodEnd: false,
          periodStartsAt: 1640000000,
          periodEndsAt: 1642592000,
          trialStartsAt: null,
          trialEndsAt: null,
        });

        expect(result.line_items[0]?.type).toBe('per_seat');
        expect(result.line_items[0]?.quantity).toBe(10);
      });

      it('should handle metered pricing type', () => {
        const result = service.build({
          id: 'sub_metered',
          accountId: 'acc_123',
          customerId: 'cus_123',
          lineItems: [
            {
              id: 'si_metered',
              quantity: 1000,
              price: {
                id: 'price_metered',
                product: 'prod_metered',
                unit_amount: 10,
                recurring: {
                  interval: 'month',
                  interval_count: 1,
                } as Stripe.Price.Recurring,
              } as Stripe.Price,
              type: 'metered',
            },
          ],
          status: 'active',
          currency: 'usd',
          cancelAtPeriodEnd: false,
          periodStartsAt: 1640000000,
          periodEndsAt: 1642592000,
          trialStartsAt: null,
          trialEndsAt: null,
        });

        expect(result.line_items[0]?.type).toBe('metered');
        expect(result.line_items[0]?.quantity).toBe(1000);
      });
    });

    describe('recurring intervals', () => {
      it('should handle monthly interval', () => {
        const result = service.build({
          id: 'sub_monthly',
          accountId: 'acc_123',
          customerId: 'cus_123',
          lineItems: [
            {
              id: 'si_monthly',
              quantity: 1,
              price: {
                id: 'price_monthly',
                product: 'prod_monthly',
                unit_amount: 1000,
                recurring: {
                  interval: 'month',
                  interval_count: 1,
                } as Stripe.Price.Recurring,
              } as Stripe.Price,
              type: 'flat',
            },
          ],
          status: 'active',
          currency: 'usd',
          cancelAtPeriodEnd: false,
          periodStartsAt: 1640000000,
          periodEndsAt: 1642592000,
          trialStartsAt: null,
          trialEndsAt: null,
        });

        expect(result.line_items[0]?.interval).toBe('month');
        expect(result.line_items[0]?.interval_count).toBe(1);
      });

      it('should handle yearly interval', () => {
        const result = service.build({
          id: 'sub_yearly',
          accountId: 'acc_123',
          customerId: 'cus_123',
          lineItems: [
            {
              id: 'si_yearly',
              quantity: 1,
              price: {
                id: 'price_yearly',
                product: 'prod_yearly',
                unit_amount: 10000,
                recurring: {
                  interval: 'year',
                  interval_count: 1,
                } as Stripe.Price.Recurring,
              } as Stripe.Price,
              type: 'flat',
            },
          ],
          status: 'active',
          currency: 'usd',
          cancelAtPeriodEnd: false,
          periodStartsAt: 1640000000,
          periodEndsAt: 1671536000,
          trialStartsAt: null,
          trialEndsAt: null,
        });

        expect(result.line_items[0]?.interval).toBe('year');
        expect(result.line_items[0]?.interval_count).toBe(1);
      });

      it('should handle custom interval counts', () => {
        const result = service.build({
          id: 'sub_custom',
          accountId: 'acc_123',
          customerId: 'cus_123',
          lineItems: [
            {
              id: 'si_custom',
              quantity: 1,
              price: {
                id: 'price_custom',
                product: 'prod_custom',
                unit_amount: 5000,
                recurring: {
                  interval: 'month',
                  interval_count: 3,
                } as Stripe.Price.Recurring,
              } as Stripe.Price,
              type: 'flat',
            },
          ],
          status: 'active',
          currency: 'usd',
          cancelAtPeriodEnd: false,
          periodStartsAt: 1640000000,
          periodEndsAt: 1647776000,
          trialStartsAt: null,
          trialEndsAt: null,
        });

        expect(result.line_items[0]?.interval).toBe('month');
        expect(result.line_items[0]?.interval_count).toBe(3);
      });
    });

    describe('trial periods', () => {
      it('should handle subscription with trial period', () => {
        const result = service.build({
          id: 'sub_with_trial',
          accountId: 'acc_123',
          customerId: 'cus_123',
          lineItems: [
            {
              id: 'si_trial',
              quantity: 1,
              price: {
                id: 'price_trial',
                product: 'prod_trial',
              } as Stripe.Price,
              type: 'flat',
            },
          ],
          status: 'trialing',
          currency: 'usd',
          cancelAtPeriodEnd: false,
          periodStartsAt: 1640000000,
          periodEndsAt: 1642592000,
          trialStartsAt: 1640000000,
          trialEndsAt: 1641209600,
        });

        expect(result.trial_starts_at).toBe('2021-12-20T11:33:20.000Z');
        expect(result.trial_ends_at).toBe('2022-01-03T11:33:20.000Z');
      });

      it('should handle subscription without trial period', () => {
        const result = service.build({
          id: 'sub_no_trial',
          accountId: 'acc_123',
          customerId: 'cus_123',
          lineItems: [
            {
              id: 'si_no_trial',
              quantity: 1,
              price: {
                id: 'price_no_trial',
                product: 'prod_no_trial',
              } as Stripe.Price,
              type: 'flat',
            },
          ],
          status: 'active',
          currency: 'usd',
          cancelAtPeriodEnd: false,
          periodStartsAt: 1640000000,
          periodEndsAt: 1642592000,
          trialStartsAt: null,
          trialEndsAt: null,
        });

        expect(result.trial_starts_at).toBeUndefined();
        expect(result.trial_ends_at).toBeUndefined();
      });
    });

    describe('cancel_at_period_end', () => {
      it('should handle cancelAtPeriodEnd true', () => {
        const result = service.build({
          id: 'sub_cancel',
          accountId: 'acc_123',
          customerId: 'cus_123',
          lineItems: [],
          status: 'active',
          currency: 'usd',
          cancelAtPeriodEnd: true,
          periodStartsAt: 1640000000,
          periodEndsAt: 1642592000,
          trialStartsAt: null,
          trialEndsAt: null,
        });

        expect(result.cancel_at_period_end).toBe(true);
      });

      it('should handle cancelAtPeriodEnd false', () => {
        const result = service.build({
          id: 'sub_no_cancel',
          accountId: 'acc_123',
          customerId: 'cus_123',
          lineItems: [],
          status: 'active',
          currency: 'usd',
          cancelAtPeriodEnd: false,
          periodStartsAt: 1640000000,
          periodEndsAt: 1642592000,
          trialStartsAt: null,
          trialEndsAt: null,
        });

        expect(result.cancel_at_period_end).toBe(false);
      });
    });

    describe('currency', () => {
      it('should handle USD currency', () => {
        const result = service.build({
          id: 'sub_usd',
          accountId: 'acc_123',
          customerId: 'cus_123',
          lineItems: [],
          status: 'active',
          currency: 'usd',
          cancelAtPeriodEnd: false,
          periodStartsAt: 1640000000,
          periodEndsAt: 1642592000,
          trialStartsAt: null,
          trialEndsAt: null,
        });

        expect(result.currency).toBe('usd');
      });

      it('should handle EUR currency', () => {
        const result = service.build({
          id: 'sub_eur',
          accountId: 'acc_123',
          customerId: 'cus_123',
          lineItems: [],
          status: 'active',
          currency: 'eur',
          cancelAtPeriodEnd: false,
          periodStartsAt: 1640000000,
          periodEndsAt: 1642592000,
          trialStartsAt: null,
          trialEndsAt: null,
        });

        expect(result.currency).toBe('eur');
      });

      it('should handle GBP currency', () => {
        const result = service.build({
          id: 'sub_gbp',
          accountId: 'acc_123',
          customerId: 'cus_123',
          lineItems: [],
          status: 'active',
          currency: 'gbp',
          cancelAtPeriodEnd: false,
          periodStartsAt: 1640000000,
          periodEndsAt: 1642592000,
          trialStartsAt: null,
          trialEndsAt: null,
        });

        expect(result.currency).toBe('gbp');
      });
    });

    describe('date formatting', () => {
      it('should convert Unix timestamps to ISO strings', () => {
        const result = service.build({
          id: 'sub_dates',
          accountId: 'acc_123',
          customerId: 'cus_123',
          lineItems: [],
          status: 'active',
          currency: 'usd',
          cancelAtPeriodEnd: false,
          periodStartsAt: 1640000000,
          periodEndsAt: 1642592000,
          trialStartsAt: null,
          trialEndsAt: null,
        });

        expect(result.period_starts_at).toBe('2021-12-20T11:33:20.000Z');
        expect(result.period_ends_at).toBe('2022-01-19T11:33:20.000Z');
      });

      it('should handle epoch time (0) as undefined', () => {
        const result = service.build({
          id: 'sub_epoch',
          accountId: 'acc_123',
          customerId: 'cus_123',
          lineItems: [],
          status: 'active',
          currency: 'usd',
          cancelAtPeriodEnd: false,
          periodStartsAt: 0,
          periodEndsAt: 0,
          trialStartsAt: null,
          trialEndsAt: null,
        });

        // 0 is falsy, so it returns undefined
        expect(result.period_starts_at).toBeUndefined();
        expect(result.period_ends_at).toBeUndefined();
      });
    });

    describe('integration scenarios', () => {
      it('should build complete SaaS subscription payload', () => {
        const result = service.build({
          id: 'sub_saas_complete',
          accountId: 'acc_saas',
          customerId: 'cus_saas',
          lineItems: [
            {
              id: 'si_base',
              quantity: 1,
              price: {
                id: 'price_base_plan',
                product: 'prod_base_plan',
                unit_amount: 2900,
                recurring: {
                  interval: 'month',
                  interval_count: 1,
                } as Stripe.Price.Recurring,
              } as Stripe.Price,
              type: 'flat',
            },
            {
              id: 'si_seats',
              quantity: 5,
              price: {
                id: 'price_additional_seat',
                product: 'prod_additional_seat',
                unit_amount: 900,
                recurring: {
                  interval: 'month',
                  interval_count: 1,
                } as Stripe.Price.Recurring,
              } as Stripe.Price,
              type: 'per_seat',
            },
            {
              id: 'si_usage',
              quantity: 5000,
              price: {
                id: 'price_api_calls',
                product: 'prod_api_calls',
                unit_amount: 1,
                recurring: {
                  interval: 'month',
                  interval_count: 1,
                } as Stripe.Price.Recurring,
              } as Stripe.Price,
              type: 'metered',
            },
          ],
          status: 'active',
          currency: 'usd',
          cancelAtPeriodEnd: false,
          periodStartsAt: 1640000000,
          periodEndsAt: 1642592000,
          trialStartsAt: null,
          trialEndsAt: null,
        });

        expect(result.billing_provider).toBe('stripe');
        expect(result.line_items).toHaveLength(3);
        expect(result.line_items[0]?.type).toBe('flat');
        expect(result.line_items[1]?.type).toBe('per_seat');
        expect(result.line_items[2]?.type).toBe('metered');
        expect(result.active).toBe(true);
      });

      it('should build trial to active transition payload', () => {
        const result = service.build({
          id: 'sub_trial_to_active',
          accountId: 'acc_123',
          customerId: 'cus_123',
          lineItems: [
            {
              id: 'si_123',
              quantity: 1,
              price: {
                id: 'price_123',
                product: 'prod_123',
                unit_amount: 1000,
                recurring: {
                  interval: 'month',
                  interval_count: 1,
                } as Stripe.Price.Recurring,
              } as Stripe.Price,
              type: 'flat',
            },
          ],
          status: 'active',
          currency: 'usd',
          cancelAtPeriodEnd: false,
          periodStartsAt: 1641209600,
          periodEndsAt: 1643801600,
          trialStartsAt: 1640000000,
          trialEndsAt: 1641209600,
        });

        expect(result.status).toBe('active');
        expect(result.trial_starts_at).toBe('2021-12-20T11:33:20.000Z');
        expect(result.trial_ends_at).toBe('2022-01-03T11:33:20.000Z');
        expect(result.period_starts_at).toBe('2022-01-03T11:33:20.000Z');
      });

      it('should build cancellation payload', () => {
        const result = service.build({
          id: 'sub_canceling',
          accountId: 'acc_123',
          customerId: 'cus_123',
          lineItems: [
            {
              id: 'si_123',
              quantity: 1,
              price: {
                id: 'price_123',
                product: 'prod_123',
              } as Stripe.Price,
              type: 'flat',
            },
          ],
          status: 'active',
          currency: 'usd',
          cancelAtPeriodEnd: true,
          periodStartsAt: 1640000000,
          periodEndsAt: 1642592000,
          trialStartsAt: null,
          trialEndsAt: null,
        });

        expect(result.status).toBe('active');
        expect(result.cancel_at_period_end).toBe(true);
        expect(result.active).toBe(true);
      });
    });
  });

  describe('getPeriodStartsAt', () => {
    it('should return current_period_start from subscription (Stripe 17 and below)', () => {
      const subscription = {
        id: 'sub_123',
        current_period_start: 1640000000,
        items: {
          data: [],
        },
      } as Stripe.Subscription;

      const result = service.getPeriodStartsAt(subscription);

      expect(result).toBe(1640000000);
    });

    it('should return current_period_start from first item (Stripe 18+)', () => {
      const subscription = {
        id: 'sub_456',
        items: {
          data: [
            {
              id: 'si_123',
              current_period_start: 1641000000,
              current_period_end: 1643000000,
            },
          ],
        },
      } as unknown as Stripe.Subscription;

      // Remove the top-level property to simulate Stripe 18+
      delete (subscription as any).current_period_start;

      const result = service.getPeriodStartsAt(subscription);

      expect(result).toBe(1641000000);
    });
  });

  describe('getPeriodEndsAt', () => {
    it('should return current_period_end from subscription (Stripe 17 and below)', () => {
      const subscription = {
        id: 'sub_123',
        current_period_end: 1642592000,
        items: {
          data: [],
        },
      } as Stripe.Subscription;

      const result = service.getPeriodEndsAt(subscription);

      expect(result).toBe(1642592000);
    });

    it('should return current_period_end from first item (Stripe 18+)', () => {
      const subscription = {
        id: 'sub_456',
        items: {
          data: [
            {
              id: 'si_123',
              current_period_start: 1641000000,
              current_period_end: 1643000000,
            },
          ],
        },
      } as unknown as Stripe.Subscription;

      // Remove the top-level property to simulate Stripe 18+
      delete (subscription as any).current_period_end;

      const result = service.getPeriodEndsAt(subscription);

      expect(result).toBe(1643000000);
    });
  });

  describe('edge cases', () => {
    it('should handle empty line items array', () => {
      const result = service.build({
        id: 'sub_empty',
        accountId: 'acc_123',
        customerId: 'cus_123',
        lineItems: [],
        status: 'canceled',
        currency: 'usd',
        cancelAtPeriodEnd: true,
        periodStartsAt: 1640000000,
        periodEndsAt: 1642592000,
        trialStartsAt: null,
        trialEndsAt: null,
      });

      expect(result.line_items).toEqual([]);
      expect(result.active).toBe(false);
    });

    it('should handle null price amounts', () => {
      const result = service.build({
        id: 'sub_null_price',
        accountId: 'acc_123',
        customerId: 'cus_123',
        lineItems: [
          {
            id: 'si_null',
            quantity: 1,
            price: {
              id: 'price_null',
              product: 'prod_null',
              unit_amount: null,
              recurring: {
                interval: 'month',
                interval_count: 1,
              } as Stripe.Price.Recurring,
            } as Stripe.Price,
            type: 'flat',
          },
        ],
        status: 'active',
        currency: 'usd',
        cancelAtPeriodEnd: false,
        periodStartsAt: 1640000000,
        periodEndsAt: 1642592000,
        trialStartsAt: null,
        trialEndsAt: null,
      });

      expect(result.line_items[0]?.price_amount).toBeNull();
    });

    it('should handle very large quantities', () => {
      const result = service.build({
        id: 'sub_large_qty',
        accountId: 'acc_123',
        customerId: 'cus_123',
        lineItems: [
          {
            id: 'si_large',
            quantity: 999999,
            price: {
              id: 'price_large',
              product: 'prod_large',
              unit_amount: 1,
              recurring: {
                interval: 'month',
                interval_count: 1,
              } as Stripe.Price.Recurring,
            } as Stripe.Price,
            type: 'metered',
          },
        ],
        status: 'active',
        currency: 'usd',
        cancelAtPeriodEnd: false,
        periodStartsAt: 1640000000,
        periodEndsAt: 1642592000,
        trialStartsAt: null,
        trialEndsAt: null,
      });

      expect(result.line_items[0]?.quantity).toBe(999999);
    });
  });
});
