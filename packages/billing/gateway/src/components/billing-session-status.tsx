import Link from 'next/link';

import { Check, ChevronRight } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Heading } from '@kit/ui/heading';
import { Trans } from '@kit/ui/trans';

/**
 * Retrieves the session status for a Stripe checkout session.
 * Since we should only arrive here for a successful checkout, we only check
 * for the `paid` status.
 **/
export function BillingSessionStatus({
  customerEmail,
  redirectPath,
}: React.PropsWithChildren<{
  customerEmail: string;
  redirectPath: string;
}>) {
  return (
    <section
      data-test={'payment-return-success'}
      className={
        'mx-auto max-w-xl rounded-xl border border-transparent p-16 fade-in xl:drop-shadow-2xl dark:border-border' +
        ' bg-background ease-out animate-in slide-in-from-bottom-8' +
        ' duration-1000 zoom-in-50 dark:shadow-2xl dark:shadow-primary/20'
      }
    >
      <div
        className={
          'flex flex-col items-center justify-center space-y-6 text-center'
        }
      >
        <Check
          className={
            'h-16 w-16 rounded-full bg-green-500 p-1 text-white ring-8' +
            ' ring-green-500/30 dark:ring-green-500/50'
          }
        />

        <Heading level={3}>
          <span className={'mr-4 font-semibold'}>
            <Trans i18nKey={'billing:checkoutSuccessTitle'} />
          </span>
          🎉
        </Heading>

        <div className={'flex flex-col space-y-4 text-muted-foreground'}>
          <p>
            <Trans
              i18nKey={'billing:checkoutSuccessDescription'}
              values={{ customerEmail }}
            />
          </p>
        </div>

        <div>
          <Button data-test={'checkout-success-back-link'} asChild>
            <Link href={redirectPath}>
              <span>
                <Trans i18nKey={'billing:checkoutSuccessBackButton'} />
              </span>

              <ChevronRight className={'h-4'} />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
