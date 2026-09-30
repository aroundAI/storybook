/**
 * @vitest-environment happy-dom
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ReportHistory } from '../src/components/report-history';

const list = vi.hoisted(() => ({
  respond: vi.fn(),
}));

vi.mock('../src/server/report-actions', () => ({
  listGeneratedReportsAction: list.respond,
  getGeneratedReportDownloadAction: vi.fn(),
  deleteGeneratedReportAction: vi.fn(),
}));

/**
 * FILM-809. The history list shows a row per generated report with its
 * type, range and record count, and says so when there is none or the read
 * failed.
 */
afterEach(cleanup);
beforeEach(() => list.respond.mockReset());

function renderHistory() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <ReportHistory accountId="11111111-1111-4111-8111-111111111111" />
    </QueryClientProvider>,
  );
}

it('shows a row per report with its records and a download and delete', async () => {
  list.respond.mockResolvedValue({
    ok: true,
    data: {
      hasMore: false,
      reports: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          reportType: 'csv',
          fileName: 'analytics-report-2026-09-01.csv',
          dateRangeStart: '2026-09-01',
          dateRangeEnd: '2026-09-30',
          recordCount: 12,
          createdAt: '2026-09-30T10:00:00Z',
        },
      ],
    },
  });

  renderHistory();

  await screen.findByText(/12 records/);
  expect(
    document.querySelectorAll('[data-test="report-history-row"]'),
  ).toHaveLength(1);
  expect(
    document.querySelector('[data-test="report-history-download"]'),
  ).not.toBeNull();
  expect(
    document.querySelector('[data-test="report-history-delete"]'),
  ).not.toBeNull();
  expect(
    document.querySelector('[data-test="report-history-older"]'),
  ).toBeNull();
});

it('says so when there are no reports', async () => {
  list.respond.mockResolvedValue({
    ok: true,
    data: { hasMore: false, reports: [] },
  });

  renderHistory();

  await screen.findByText(/No reports generated yet/);
});

it('shows the refusal, with a retry, when the read fails', async () => {
  list.respond.mockResolvedValue({ ok: false, error: 'Could not list' });

  renderHistory();

  await screen.findByText('Could not list');
  await screen.findByText('Try again');
});
