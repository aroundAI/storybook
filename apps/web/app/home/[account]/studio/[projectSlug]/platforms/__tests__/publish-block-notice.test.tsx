import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * KB-213. Meta refused a Facebook post with code 368 ("Confirm your
 * identity before you can publish as this Page") and the connection is
 * paused. Settings → Platforms says what to do, and Retry clears it.
 */

const retry = vi.hoisted(() => vi.fn());

vi.mock(
  '../../../../../../../../../packages/features/publishing/src/server/connection-actions',
  () => ({
    countScheduledPublishesAction: vi.fn(),
    disconnectPlatformAction: vi.fn(),
    getConnectionsAction: vi.fn(),
    refreshConnectionAction: vi.fn(),
    retryPublishingAction: retry,
    updateConnectionLanguageAction: vi.fn(),
  }),
);
vi.mock('@kit/ui/sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { PublishBlockNotice } = await import(
  '../../../../../../../../../packages/features/publishing/src/components/platform-connections'
);

afterEach(cleanup);

const byTest = (name: string) =>
  document.querySelector<HTMLElement>(`[data-test="${name}"]`)!;

function renderNotice() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <PublishBlockNotice
        connectionId="conn-fb"
        platform="facebook"
        accountId="a1"
        block={{
          message: 'Confirm your identity before you can publish as this Page.',
          at: '2026-10-20T00:31:00Z',
        }}
      />
    </QueryClientProvider>,
  );
}

describe('a Facebook Page Meta has paused (KB-213)', () => {
  it('says what to do in plain words, with Meta’s own', () => {
    renderNotice();

    expect(byTest('publish-block-banner').textContent).toBe(
      'Facebook asked you to confirm your identity for this Page. Open the Facebook app, follow its instructions, then press Retry. Posts to this Page wait until then.',
    );
    expect(byTest('publish-block-message').textContent).toContain(
      'Meta said: “Confirm your identity before you can publish as this Page.”',
    );
  });

  it('clears the block for that connection on Retry', async () => {
    retry.mockResolvedValue({ ok: true, data: { success: true } });
    renderNotice();

    fireEvent.click(byTest('publish-block-retry'));

    await vi.waitFor(() =>
      expect(retry).toHaveBeenCalledWith({ connectionId: 'conn-fb' }),
    );
  });
});
