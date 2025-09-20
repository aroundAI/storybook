import type { Stripe } from 'stripe';
import { z } from 'zod';

import type { CreateBillingCheckoutSchema } from '@kit/billing/schema';

/**
 * @description If set to true, users can start a trial without entering their credit card details
 */
const enableTrialWithoutCreditCard =
  process.env.STRIPE_ENABLE_TRIAL_WITHOUT_CC === 'true';

/**
 * @name createStripeCheckout
 * @description Creates a Stripe Checkout session, and returns an Object
 * containing the session, which you can use to redirect the user to the
 * checkout page
 */
export async function createStripeCheckout(
  stripe: Stripe,
  params: z.infer<typeof CreateBillingCheckoutSchema>,
) {
  // in MakerKit, a subscription belongs to an organization,
  // rather than to a user
  // if you wish to change it, use the current user ID instead
  const clientReferenceId = params.accountId;

  // we pass an optional customer ID, so we do not duplicate the Stripe
  // customers if an organization subscribes multiple times
  const customer = params.customerId ?? undefined;

  // docs: https://stripe.com/docs/billing/subscriptions/build-subscription
  const mode: Stripe.Checkout.SessionCreateParams.Mode =
    params.plan.paymentType === 'recurring' ? 'subscription' : 'payment';

  const isSubscription = mode === 'subscription';

  let trialDays: number | null | undefined = params.plan.trialDays;

  // if the customer already exists, we do not set a trial period
  if (customer) {
    trialDays = undefined;
  }

  const trialSettings =
    trialDays && enableTrialWithoutCreditCard
      ? {
          trial_settings: {
            end_behavior: {
              missing_payment_method: 'cancel' as const,
            },
          },
        }
      : {};

  // this should only be set if the mode is 'subscription'
  const subscriptionData:
    | Stripe.Checkout.SessionCreateParams.SubscriptionData
    | undefined = isSubscription
    ? {
        trial_period_days: trialDays,
        metadata: {
          accountId: params.accountId,
          ...(params.metadata ?? {}),
        },
        ...trialSettings,
      }
    : {};

  const urls = getUrls({
    returnUrl: params.returnUrl,
  });

  // we use the embedded mode, so the user does not leave the page
  const uiMode = 'embedded';

  const customerData = customer
    ? {
        customer,
      }
    : {
        customer_email: params.customerEmail,
      };

  const customerCreation =
    isSubscription || customer
      ? ({} as Record<string, string>)
      : { customer_creation: 'always' };

  const lineItems = params.plan.lineItems.map((item) => {
    if (item.type === 'metered') {
      return {
        price: item.id,
      };
    }

    // if we pass a custom quantity for the item ID
    // we use that - otherwise we set it to 1 by default
    const quantity =
      params.variantQuantities.find((variant) => {
        return variant.variantId === item.id;
      })?.quantity ?? 1;

    return {
      price: item.id,
      quantity,
    };
  });

  const paymentCollectionMethod =
    enableTrialWithoutCreditCard && params.plan.trialDays
      ? {
          payment_method_collection: 'if_required' as const,
        }
      : {};

  return stripe.checkout.sessions.create({
    mode,
    allow_promotion_codes: params.enableDiscountField,
    ui_mode: uiMode,
    line_items: lineItems,
    client_reference_id: clientReferenceId,
    subscription_data: subscriptionData,
    ...customerCreation,
    ...customerData,
    ...urls,
    ...paymentCollectionMethod,
  });
}

function getUrls(params: { returnUrl: string }) {
  const returnUrl = `${params.returnUrl}?session_id={CHECKOUT_SESSION_ID}`;

  return {
    return_url: returnUrl,
  };
}
