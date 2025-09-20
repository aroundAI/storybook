'use client';

import { useState } from 'react';

import {
  EmbeddedCheckout,
  EmbeddedCheckoutProvider,
} from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';

import { Dialog, DialogContent, DialogTitle } from '@kit/ui/dialog';

import { StripeClientEnvSchema } from '../schema/stripe-client-env.schema';

const { publishableKey } = StripeClientEnvSchema.parse({
  publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
});

const stripePromise = loadStripe(publishableKey);

export function StripeCheckout({
  checkoutToken,
  onClose,
}: React.PropsWithChildren<{
  checkoutToken: string;
  onClose?: () => void;
}>) {
  return (
    <EmbeddedCheckoutPopup key={checkoutToken} onClose={onClose}>
      <EmbeddedCheckoutProvider
        stripe={stripePromise}
        options={{ clientSecret: checkoutToken }}
      >
        <EmbeddedCheckout className={'EmbeddedCheckoutClassName'} />
      </EmbeddedCheckoutProvider>
    </EmbeddedCheckoutPopup>
  );
}

function EmbeddedCheckoutPopup({
  onClose,
  children,
}: React.PropsWithChildren<{
  onClose?: () => void;
}>) {
  const [open, setOpen] = useState(true);
  const className = `bg-white p-4 overflow-y-auto shadow-transparent border`;

  return (
    <Dialog
      defaultOpen
      open={open}
      onOpenChange={(open) => {
        if (!open && onClose) {
          onClose();
        }

        setOpen(open);
      }}
    >
      <DialogContent
        style={{
          maxHeight: '98vh',
        }}
        className={className}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogTitle className={'hidden'}>Checkout</DialogTitle>
        <div>{children}</div>
      </DialogContent>
    </Dialog>
  );
}
