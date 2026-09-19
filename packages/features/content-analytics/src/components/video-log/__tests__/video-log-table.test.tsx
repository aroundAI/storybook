/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { VideoLogRow } from '../../../server/video-log-actions';
import { VideoLogTable } from '../video-log-table';

vi.mock('lucide-react', () => ({
  ArrowDown: () => <span />,
  ArrowUp: () => <span />,
  ChevronsUpDown: () => <span />,
}));

vi.mock('@kit/ui/table', () => ({
  Table: (props: React.ComponentProps<'table'>) => <table {...props} />,
  TableBody: (props: React.ComponentProps<'tbody'>) => <tbody {...props} />,
  TableCell: (props: React.ComponentProps<'td'>) => <td {...props} />,
  TableHead: (props: React.ComponentProps<'th'>) => <th {...props} />,
  TableHeader: (props: React.ComponentProps<'thead'>) => <thead {...props} />,
  TableRow: (props: React.ComponentProps<'tr'>) => <tr {...props} />,
}));

vi.mock('@kit/ui/badge', () => ({
  Badge: (props: React.ComponentProps<'span'>) => <span {...props} />,
}));

// The tooltip is a portal in the real component; the trigger is what carries
// the explanation for assistive technology, and that is what is asserted.
vi.mock('@kit/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipContent: () => null,
}));

vi.mock('../note-cell', () => ({
  NoteCell: ({ note }: { note: string | null }) => (
    <span data-test={'note-stub'}>{note ?? ''}</span>
  ),
}));

const CHECKPOINTS = [30, 90];

function row(overrides: Partial<VideoLogRow> = {}): VideoLogRow {
  return {
    videoId: 'v1',
    title: 'A video',
    // Two years old, so every checkpoint below has elapsed.
    publishedAt: '2024-03-15 12:00:00',
    channelName: 'Main channel',
    platform: 'youtube',
    contentType: 'long',
    language: 'en',
    viewsAtAge: { 30: 1234567, 90: 2000000 },
    matureAt: { 30: true, 90: true },
    predatesIngestAt: { 30: false, 90: false },
    lifetimeViews: 3000000,
    ingestLagDays: 0,
    impressions: 100000,
    ctr: 0.042,
    avgViewDurationSeconds: 185,
    avgViewPercentage: 48.5,
    revenue: [],
    analyticsNote: null,
    analyticsNoteUpdatedAt: null,
    canEditNote: false,
    ...overrides,
  };
}

function renderTable(
  rows: VideoLogRow[],
  orderBy: 'title' | 'lifetime_views' = 'lifetime_views',
) {
  return render(
    <VideoLogTable
      rows={rows}
      checkpoints={CHECKPOINTS}
      view={{ orderBy, orderDirection: 'desc', page: 0 }}
      onSort={vi.fn()}
      onNoteSaved={vi.fn()}
      onNotePermissionLost={vi.fn()}
    />,
  );
}

const testId = (id: string) => document.querySelectorAll(`[data-test="${id}"]`);

describe('VideoLogTable', () => {
  it('shows a measured checkpoint as a number, grouped', () => {
    renderTable([row()]);

    expect(testId('checkpoint-figure')[0]?.textContent).toBe('1,234,567');
  });

  it('shows a real zero as 0, not as missing data', () => {
    renderTable([row({ viewsAtAge: { 30: 0, 90: 0 } })]);

    expect(testId('checkpoint-figure')[0]?.textContent).toBe('0');
  });

  it('never renders a number for a video too young to have the figure', () => {
    // Published today: neither checkpoint has elapsed.
    const publishedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');

    renderTable([
      row({ publishedAt, matureAt: { 30: false, 90: false }, viewsAtAge: {} }),
    ]);

    const cells = testId('checkpoint-immature');

    expect(cells).toHaveLength(2);
    expect(testId('checkpoint-figure')).toHaveLength(0);
    expect(cells[0]?.textContent).toMatch(/^in \d+ days?$/);
  });

  it('says a window closed before analytics began, and explains why', () => {
    renderTable([
      row({ ingestLagDays: 120, predatesIngestAt: { 30: true, 90: true } }),
    ]);

    const cell = testId('checkpoint-predates')[0];

    expect(cell?.textContent).toBe('n/a');
    expect(cell?.getAttribute('aria-label')).toContain("can't be recovered");
  });

  it('distinguishes a video with no analytics at all from a zero', () => {
    renderTable([row({ ingestLagDays: null })]);

    expect(testId('checkpoint-no-data')).toHaveLength(2);
    expect(testId('checkpoint-figure')).toHaveLength(0);
  });

  it('flags a row whose first days were missed', () => {
    renderTable([row({ ingestLagDays: 5 })]);

    expect(
      testId('video-log-partial')[0]?.getAttribute('aria-label'),
    ).toContain('analytics began 5 days after publication');
  });

  it('does not flag a row whose analytics began the same day', () => {
    renderTable([row({ ingestLagDays: 1 })]);

    expect(testId('video-log-partial')).toHaveLength(0);
  });

  it('gives a reason rather than 0% when there were no impressions', () => {
    renderTable([row({ impressions: 0, ctr: 0 })]);

    expect(testId('ctr-value')).toHaveLength(0);
    expect(testId('ctr-none')[0]?.getAttribute('aria-label')).toContain(
      'No impressions recorded.',
    );
  });

  it('lists revenue per currency and never adds them together', () => {
    renderTable([
      row({
        revenue: [
          { currency: 'USD', cents: 1200 },
          { currency: 'EUR', cents: 500 },
        ],
      }),
    ]);

    expect(testId('revenue')[0]?.textContent).toBe('$12.00 + €5.00');
  });

  it('shows an amount whose currency was never recorded, saying so', () => {
    renderTable([row({ revenue: [{ currency: null, cents: 950 }] })]);

    expect(testId('revenue')[0]?.textContent).toBe(
      '9.50 (currency not recorded)',
    );
  });

  it('marks only the server-sortable columns as sortable', () => {
    renderTable([row()]);

    const headers = Array.from(document.querySelectorAll('th'));
    const sortable = headers.filter((th) => th.querySelector('button'));

    expect(sortable.map((th) => th.textContent)).toEqual([
      'Video',
      'Published',
      'Lifetime views',
    ]);

    // A column the server cannot order by must not offer to: sorting it in
    // the browser would sort this page while claiming to sort the log.
    const channel = headers.find((th) => th.textContent === 'Channel');

    expect(channel?.querySelector('button')).toBeNull();
  });

  it('tells assistive technology which column is sorted, and which way', () => {
    renderTable([row()]);

    const headers = Array.from(document.querySelectorAll('th'));
    const sorted = headers.find((th) => th.textContent === 'Lifetime views');

    expect(sorted?.getAttribute('aria-sort')).toBe('descending');
    expect(
      headers
        .find((th) => th.textContent === 'Video')
        ?.getAttribute('aria-sort'),
    ).toBe('none');
  });

  it('says which figures are a first-N-days window and which are lifetime', () => {
    renderTable([row()]);

    const labels = Array.from(document.querySelectorAll('th')).map(
      (th) => th.textContent,
    );

    expect(labels).toContain('Views in first 30 days');
    expect(labels).toContain('Views in first 90 days');
    expect(labels).toContain('CTR (lifetime)');
  });

  it('names an untitled video rather than rendering an empty cell', () => {
    renderTable([row({ title: '' })]);

    expect(screen.getByText('Untitled')).toBeTruthy();
  });
});
