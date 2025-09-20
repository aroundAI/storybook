import { z } from 'zod';

export const StripeServerEnvSchema = z
  .object({
    secretKey: z
      .string({
        required_error: `Please provide the variable STRIPE_SECRET_KEY`,
      })
      .min(1),
    webhooksSecret: z
      .string({
        required_error: `Please provide the variable STRIPE_WEBHOOK_SECRET`,
      })
      .min(1),
  })
  .refine(
    (schema) => {
      const key = schema.secretKey;
      const secretKeyPrefix = 'sk_';
      const restrictKeyPrefix = 'rk_';

      return (
        key.startsWith(secretKeyPrefix) || key.startsWith(restrictKeyPrefix)
      );
    },
    {
      path: ['STRIPE_SECRET_KEY'],
      message: `Stripe secret key must start with 'sk_' or 'rk_'`,
    },
  )
  .refine(
    (schema) => {
      return schema.webhooksSecret.startsWith('whsec_');
    },
    {
      path: ['STRIPE_WEBHOOK_SECRET'],
      message: `Stripe webhook secret must start with 'whsec_'`,
    },
  );
