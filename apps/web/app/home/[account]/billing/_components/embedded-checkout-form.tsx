'use client';

import dynamic from 'next/dynamic';

export const EmbeddedCheckoutForm = dynamic(
  async () => {
    const { EmbeddedCheckout } = await import('@kit/billing-gateway/checkout');

    return EmbeddedCheckout;
  },
  {
    ssr: false,
  },
);
