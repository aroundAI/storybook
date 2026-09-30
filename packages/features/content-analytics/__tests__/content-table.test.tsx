/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ContentTable } from '../src/components/content-table';
import type { ContentTableTagging } from '../src/components/content-table';
import type { ContentListItem } from '../src/server/aggregation-queries';

vi.mock('next/image', () => ({
  default: () => null,
}));

afterEach(cleanup);

function byTest(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-test="${id}"]`);
  if (!element) throw new Error(`no [data-test="${id}"]`);
  return element;
}

function item(publishId: string, title: string): ContentListItem {
  return {
    publishId,
    episodeId: `episode-${publishId}`,
    episodeTitle: 'Episode',
    publishTitle: title,
    platform: 'youtube',
    thumbnailUrl: null,
    publishedAt: '2026-01-10T00:00:00Z',
    views: 100,
    likes: 1,
    comments: 0,
    shares: 0,
    saves: 0,
    engagementRate: 1,
  };
}

const DATA = [item('p1', 'First video'), item('p2', 'Second video')];

const TAGS = [
  { id: 't1', dimension: 'topic', slug: 'volcanoes', label: 'Volcanoes' },
];

function tagging(
  overrides: Partial<ContentTableTagging> = {},
): ContentTableTagging {
  return {
    tags: TAGS,
    tagsByPublish: { p1: TAGS },
    isLoading: false,
    isError: false,
    onApply: vi.fn(async () => null),
    ...overrides,
  };
}

describe('ContentTable with tagging', () => {
  it('shows each row its tags and says so when it has none', () => {
    render(<ContentTable data={DATA} tagging={tagging()} />);

    const cells = document.querySelectorAll('[data-test="content-row-tags"]');

    expect(cells[0]!.textContent).toContain('Volcanoes');
    expect(cells[1]!.textContent).toBe('Untagged');
  });

  it('labels every checkbox for a screen reader', () => {
    render(<ContentTable data={DATA} tagging={tagging()} />);

    expect(byTest('content-select-all').getAttribute('aria-label')).toBe(
      'Select all content',
    );
    expect(
      Array.from(
        document.querySelectorAll('[data-test="content-row-select"]'),
      ).map((box) => box.getAttribute('aria-label')),
    ).toEqual(['Select First video', 'Select Second video']);
  });

  it('offers no bulk action until a row is selected, then tags exactly those rows', async () => {
    const onApply = vi.fn(async () => null);

    render(<ContentTable data={DATA} tagging={tagging({ onApply })} />);

    expect(
      document.querySelector('[data-test="content-tag-selected"]'),
    ).toBeNull();

    fireEvent.click(
      document.querySelectorAll('[data-test="content-row-select"]')[1]!,
    );

    expect(byTest('content-selected-count').textContent).toBe('1 selected');
    expect(byTest('content-tag-selected').hasAttribute('disabled')).toBe(true);

    fireEvent.click(byTest('tag-picker-trigger'));
    fireEvent.click(await waitFor(() => byTest('tag-picker-option-t1')));
    fireEvent.click(byTest('content-tag-selected'));

    await waitFor(() => expect(onApply).toHaveBeenCalledWith(['p2'], ['t1']));
    await waitFor(() =>
      expect(byTest('content-bulk-done').textContent).toBe('Tagged 1 video.'),
    );
    expect(
      document.querySelector('[data-test="content-selected-count"]'),
    ).toBeNull();
  });

  it('shows the refusal as written and keeps the selection', async () => {
    const onApply = vi.fn(async () => 'That tag belongs to another account.');

    render(<ContentTable data={DATA} tagging={tagging({ onApply })} />);
    fireEvent.click(byTest('content-select-all'));
    fireEvent.click(byTest('tag-picker-trigger'));
    fireEvent.click(await waitFor(() => byTest('tag-picker-option-t1')));
    fireEvent.click(byTest('content-tag-selected'));

    await waitFor(() =>
      expect(byTest('content-bulk-refused').textContent).toBe(
        'That tag belongs to another account.',
      ),
    );
    expect(byTest('content-selected-count').textContent).toBe('2 selected');
  });

  it('says tags could not be loaded rather than showing no tags', () => {
    render(
      <ContentTable
        data={DATA}
        tagging={tagging({ isError: true, tags: [] })}
      />,
    );

    expect(byTest('content-tags-error').textContent).toContain('fetch failure');
    expect(
      document.querySelectorAll('[data-test="content-row-tags"]')[0]!
        .textContent,
    ).toBe('Not loaded');
  });

  it('keeps the plain table when no tagging is given', () => {
    render(<ContentTable data={DATA} />);

    expect(
      document.querySelector('[data-test="content-select-all"]'),
    ).toBeNull();
    expect(document.querySelector('[data-test="content-row-tags"]')).toBeNull();
  });

  it('says there is no content when the list is empty', () => {
    render(<ContentTable data={[]} tagging={tagging()} />);

    expect(document.body.textContent).toContain('No content published yet.');
  });
});
