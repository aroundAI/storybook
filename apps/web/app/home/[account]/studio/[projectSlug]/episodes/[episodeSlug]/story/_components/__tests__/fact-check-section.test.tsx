import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FactCheckSection } from '../fact-check-section';

/**
 * FILM-1123: the fact-check results show each issue with styling that matches
 * its severity, and say when the story should be held back.
 */

configure({ testIdAttribute: 'data-test' });

const actions = vi.hoisted(() => ({ factCheckContentAction: vi.fn() }));

vi.mock('@kit/episodes/server', () => actions);

const issue = (severity: string, claim: string) => ({
  severity,
  claimInContent: claim,
  issueType: 'contradiction',
  explanation: `${claim} is wrong`,
  suggestion: 'Fix it',
});

const result = {
  overallVerdict: 'fail',
  accuracyScore: 0.5,
  totalClaimsFound: 4,
  verifiedClaims: 2,
  summary: 'Two claims disagree with the facts.',
  issues: [
    issue('critical', 'The bridge fell in 1990'),
    issue('warning', 'About 300 people'),
    issue('minor', 'A cold morning'),
  ],
  missingRequiredClaims: ['The date of the flood'],
};

async function runCheck(blocked: boolean) {
  actions.factCheckContentAction.mockResolvedValue({
    ok: true,
    data: { result, blocked },
  });
  render(<FactCheckSection projectId="project-1" storyContent="The story." />);
  fireEvent.click(screen.getByTestId('fact-check-run'));
  return screen.findAllByTestId('fact-check-issue');
}

const severityBadge = (row: HTMLElement) =>
  row.querySelector('div') as HTMLElement;

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('FactCheckSection', () => {
  it('styles each issue by its severity, replacing the default badge colour', async () => {
    const rows = await runCheck(true);

    const [critical, warning, minor] = rows.map(severityBadge);
    expect(critical!.textContent).toBe('critical');
    expect(critical!.className).toContain('bg-red-100');
    expect(critical!.className).not.toContain('bg-primary');
    expect(warning!.className).toContain('bg-yellow-100');
    expect(minor!.className).toContain('bg-muted');
  });

  it('shows the verdict, the score, the explanation and the missing claims', async () => {
    const rows = await runCheck(true);

    expect(screen.getByTestId('fact-check-verdict').textContent).toBe('fail');
    expect(screen.getByTestId('fact-check-result').textContent).toContain(
      'accuracy 50% - 2 of 4 claims verified',
    );
    expect(rows[0]!.textContent).toContain('The bridge fell in 1990');
    expect(rows[0]!.textContent).toContain('Fix it');
    expect(screen.getByTestId('fact-check-result').textContent).toContain(
      'Missing: The date of the flood',
    );
  });

  it('tells the writer to hold the story back when it is blocked', async () => {
    await runCheck(true);

    expect(screen.getByTestId('fact-check-blocked')).toBeTruthy();
  });

  it('does not hold back a story the check did not block', async () => {
    await runCheck(false);

    expect(screen.queryByTestId('fact-check-blocked')).toBeNull();
  });

  it('shows a refusal as text and keeps the button usable', async () => {
    actions.factCheckContentAction.mockResolvedValue({
      ok: false,
      error: 'Too many fact checks. Wait a minute.',
    });
    render(
      <FactCheckSection projectId="project-1" storyContent="The story." />,
    );
    fireEvent.click(screen.getByTestId('fact-check-run'));

    const error = await screen.findByTestId('fact-check-error');
    expect(error.textContent).toContain('Too many fact checks');
    expect(
      (screen.getByTestId('fact-check-run') as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});
