import Link from 'next/link';

import { TriangleAlert } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@kit/ui/alert';
import { Button } from '@kit/ui/button';
import { Trans } from '@kit/ui/trans';

import { createI18nServerInstance } from '~/lib/i18n/i18n.server';
import {
  CONNECT_PLATFORM_LABELS,
  ConnectFailure,
} from '~/lib/platforms/connect-failure';

interface PlatformConnectFailureProps {
  failure: ConnectFailure;
  /** This page without the failure in its address. */
  dismissHref: string;
}

/**
 * Says why a platform connect failed (KB-19): what happened, on which
 * platform, and what to do next.
 *
 * A server component. The failure is read from the address, so dismissing it
 * is a link to the same page without it — no state, and nothing to persist.
 *
 * Only our own platform label is interpolated into a translation: `Trans`
 * turns markup in a translated string into elements, so the vendor's words
 * never go through it. They are rendered as a text node.
 */
export async function PlatformConnectFailure({
  failure,
  dismissHref,
}: PlatformConnectFailureProps) {
  const i18n = await createI18nServerInstance();

  const platform = failure.platform
    ? CONNECT_PLATFORM_LABELS[failure.platform]
    : i18n.t('platforms:connectFailure.unknownPlatform');

  return (
    <Alert
      variant="destructive"
      className="mb-6"
      data-test="connect-failure"
      data-code={failure.code}
      data-platform={failure.platform ?? 'unknown'}
    >
      <TriangleAlert className="h-4 w-4" />

      <AlertTitle
        className="first-letter:uppercase"
        data-test="connect-failure-title"
      >
        <Trans i18nKey="platforms:connectFailure.title" values={{ platform }} />
      </AlertTitle>

      <AlertDescription className="flex flex-col gap-y-3 text-foreground">
        <p
          className="first-letter:uppercase"
          data-test="connect-failure-message"
        >
          <Trans
            i18nKey={`platforms:connectFailure.message.${failure.code}`}
            values={{ platform }}
          />
        </p>

        <p data-test="connect-failure-action">
          <Trans
            i18nKey={`platforms:connectFailure.action.${failure.code}`}
            values={{ platform }}
          />
        </p>

        {(failure.vendorCode || failure.vendorMessage) && (
          <div
            className="flex flex-col gap-y-1 rounded-md border bg-muted/50 p-3 text-xs text-muted-foreground"
            data-test="connect-failure-vendor"
          >
            <p className="font-medium">
              <Trans
                i18nKey="platforms:connectFailure.vendorHeading"
                values={{ platform }}
              />
            </p>

            {failure.vendorCode && (
              <p className="font-mono break-all">
                <Trans i18nKey="platforms:connectFailure.vendorCode" />{' '}
                <span data-test="connect-failure-vendor-code">
                  {failure.vendorCode}
                </span>
              </p>
            )}

            {failure.vendorMessage && (
              <p
                className="font-mono break-all"
                data-test="connect-failure-vendor-text"
              >
                {failure.vendorMessage}
              </p>
            )}

            {failure.vendorLogId && (
              <p className="font-mono break-all">
                <Trans i18nKey="platforms:connectFailure.vendorLogId" />{' '}
                <span data-test="connect-failure-vendor-log-id">
                  {failure.vendorLogId}
                </span>
              </p>
            )}
          </div>
        )}

        <div>
          <Button asChild variant="outline" size="sm">
            <Link
              href={dismissHref}
              replace
              data-test="connect-failure-dismiss"
            >
              <Trans i18nKey="platforms:connectFailure.dismiss" />
            </Link>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
