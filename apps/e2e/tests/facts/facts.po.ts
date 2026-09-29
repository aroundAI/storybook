import { Locator, Page, expect } from '@playwright/test';

import {
  SeededProject,
  SeededTeam,
  insertRow,
  readRows,
  seedMembership,
  seedProject,
  seedTeamAccount,
  seedUser,
  uniqueStamp,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest, visible } from '../utils/visible';

const SERVICE_ROLE_KEY =
  process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const service = { key: SERVICE_ROLE_KEY };

export interface SeededFact {
  id: string;
  claim: string;
}

export interface FactRow {
  id: string;
  verification_status: string;
  verified_by: string | null;
  verified_by_name: string | null;
  verification_notes: string | null;
}

/**
 * The Fact Library (KB-18): a seeded team whose owner is the project's owner,
 * with facts written through the service role — adding a fact has its own
 * form, and is not what these specs are about.
 */
export class FactsPageObject {
  constructor(private readonly page: Page) {}

  async seedProjectWithFacts(count: number) {
    const team = await seedTeamAccount({ emailPrefix: 'kb18' });
    const project = await seedProject(team);
    const stamp = uniqueStamp().slice(0, 8);

    const facts: SeededFact[] = [];

    for (let i = 1; i <= count; i++) {
      const claim = `Fact ${i} ${stamp}: the lighthouse was first lit in 18${40 + i}`;

      const row = await insertRow<{ id: string }>(
        'verified_facts',
        {
          project_id: project.id,
          claim,
          source_type: 'historical_record',
          source_citation: `Harbour Board minutes, volume ${i}`,
        },
        service,
      );

      facts.push({ id: row.id, claim });
    }

    return { team, project, facts };
  }

  /** A member of the team who is on the project as a plain `member`. */
  async seedProjectMember(team: SeededTeam, project: SeededProject) {
    const member = await seedUser('kb18-member');

    await seedMembership(member.userId, team.accountId, 'member');
    await insertRow(
      'project_members',
      { project_id: project.id, user_id: member.userId, role: 'member' },
      service,
    );

    return member;
  }

  signIn(user: { email: string; password: string }) {
    return signInAs(this.page, user);
  }

  async goto(team: SeededTeam, project: SeededProject) {
    await this.page.goto(
      `/home/${team.slug}/studio/${project.slug}/settings/facts`,
    );
    await expect(byTest(this.page, 'fact-card').first()).toBeVisible();
  }

  /** The card on screen, not React's hidden streamed copy (`utils/visible.ts`). */
  card(fact: SeededFact): Locator {
    return visible(
      this.page,
      `[data-test="fact-card"][data-fact-id="${fact.id}"]`,
    );
  }

  status(fact: SeededFact): Locator {
    return byTest(this.card(fact), 'fact-status');
  }

  verifyButton(fact: SeededFact): Locator {
    return byTest(this.card(fact), 'fact-verify-button');
  }

  dialog(): Locator {
    return byTest(this.page, 'fact-review-dialog');
  }

  notes(): Locator {
    return byTest(this.dialog(), 'fact-review-notes');
  }

  async openReview(fact: SeededFact) {
    await this.verifyButton(fact).click();
    await expect(this.dialog()).toBeVisible();
    await expect(byTest(this.dialog(), 'fact-review-claim')).toHaveText(
      fact.claim,
    );
  }

  confirmVerified() {
    return byTest(this.dialog(), 'fact-confirm-verified').click();
  }

  markDisputed() {
    return byTest(this.dialog(), 'fact-mark-disputed').click();
  }

  successToast(text: string): Locator {
    return this.page
      .locator('[data-sonner-toast][data-type="success"]')
      .filter({ hasText: text });
  }

  errorToast(): Locator {
    return this.page.locator('[data-sonner-toast][data-type="error"]').first();
  }

  async openDetails(fact: SeededFact) {
    await this.card(fact).getByRole('link', { name: 'Details' }).click();
    await this.page.waitForURL(`**/settings/facts/${fact.id}`);
  }

  verifiedBy(): Locator {
    return byTest(this.page, 'fact-verified-by');
  }

  async readFacts(facts: SeededFact[]) {
    const rows = await readRows<FactRow>(
      'verified_facts',
      `select=id,verification_status,verified_by,verified_by_name,verification_notes&id=in.(${facts
        .map((f) => f.id)
        .join(',')})`,
    );

    return new Map(rows.map((row) => [row.id, row]));
  }
}
