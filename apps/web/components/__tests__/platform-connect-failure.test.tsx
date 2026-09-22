import type { ComponentProps, ReactNode } from 'react';

import { configure, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PlatformConnectFailure } from '../platform-connect-failure';

// The attribute the Playwright specs use, so both read the same hooks.
configure({ testIdAttribute: 'data-test' });

vi.mock('~/lib/i18n/i18n.server', () => ({
  createI18nServerInstance: async () => ({ t: (key: string) => key }),
}));

// The real `Trans` needs an i18n instance; what matters here is which key and
// which values reach it.
vi.mock('@kit/ui/trans', () => ({
  Trans: (props: { i18nKey: string; values?: Record<string, string> }) =>
    `${props.i18nKey}|${Object.values(props.values ?? {}).join(',')}`,
}));

// Plain elements in place of the styled ones: they keep every attribute the
// assertions read, and the subject here is what is rendered inside them.
vi.mock('@kit/ui/alert', () => ({
  Alert: ({
    variant: _variant,
    ...props
  }: ComponentProps<'div'> & { variant: string }) => <div {...props} />,
  AlertTitle: (props: ComponentProps<'h5'>) => <h5 {...props} />,
  AlertDescription: (props: ComponentProps<'div'>) => <div {...props} />,
}));

vi.mock('@kit/ui/button', () => ({
  Button: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const HOSTILE =
  '<script>window.__kb19 = 1</script><img src=x onerror=alert(1)>';

async function renderFailure(
  failure: Parameters<typeof PlatformConnectFailure>[0]['failure'],
) {
  const { container } = render(
    await PlatformConnectFailure({
      failure,
      dismissHref: '/home/acme/settings/platforms',
    }),
  );

  return container;
}

describe('PlatformConnectFailure', () => {
  it('looks the message and the next step up by code, for the platform', async () => {
    await renderFailure({
      code: 'invalid_scope',
      platform: 'tiktok',
      vendorCode: null,
      vendorMessage: null,
      vendorLogId: null,
    });

    expect(screen.getByTestId('connect-failure')).toHaveAttribute(
      'data-code',
      'invalid_scope',
    );
    expect(screen.getByTestId('connect-failure-title')).toHaveTextContent(
      'platforms:connectFailure.title|TikTok',
    );
    expect(screen.getByTestId('connect-failure-message')).toHaveTextContent(
      'platforms:connectFailure.message.invalid_scope|TikTok',
    );
    expect(screen.getByTestId('connect-failure-action')).toHaveTextContent(
      'platforms:connectFailure.action.invalid_scope|TikTok',
    );
    expect(screen.queryByTestId('connect-failure-vendor')).toBeNull();
  });

  it('shows the vendor’s words as text, never as markup', async () => {
    const container = await renderFailure({
      code: 'access_denied',
      platform: 'meta',
      vendorCode: HOSTILE,
      vendorMessage: HOSTILE,
      vendorLogId: HOSTILE,
    });

    expect(screen.getByTestId('connect-failure-vendor-text').textContent).toBe(
      HOSTILE,
    );
    expect(screen.getByTestId('connect-failure-vendor-code').textContent).toBe(
      HOSTILE,
    );
    expect(
      screen.getByTestId('connect-failure-vendor-log-id').textContent,
    ).toBe(HOSTILE);
    expect(container.querySelectorAll('script, img')).toHaveLength(0);
  });

  it('dismisses by linking to the page without the failure', async () => {
    await renderFailure({
      code: 'state_expired',
      platform: 'youtube',
      vendorCode: null,
      vendorMessage: null,
      vendorLogId: null,
    });

    expect(screen.getByTestId('connect-failure-dismiss')).toHaveAttribute(
      'href',
      '/home/acme/settings/platforms',
    );
  });
});
