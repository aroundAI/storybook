import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { TeamAccountLayoutPageHeader } from '../team-account-layout-page-header';

afterEach(cleanup);

describe('TeamAccountLayoutPageHeader', () => {
  it('renders the title as the page heading, above the description', () => {
    render(
      <TeamAccountLayoutPageHeader
        account="acme"
        title="Dashboard"
        description={<nav aria-label="breadcrumb">Home / Dashboard</nav>}
      />,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Dashboard' }),
    ).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'breadcrumb' })).toBeTruthy();
  });
});
