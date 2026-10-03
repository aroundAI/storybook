import { expect, test } from '@playwright/test';

import { insertRow, seedTeamAccount, serviceRoleAuth } from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * KB-181. The bell filled only after a reload: the Realtime channel joined
 * as `anon`, Realtime evaluated the notifications RLS with no user and
 * dropped every insert, while the channel still reported SUBSCRIBED. The
 * hook can only be seen working with a real socket, a real session and a
 * real insert.
 *
 * Needs the app built with NEXT_PUBLIC_REALTIME_NOTIFICATIONS=true, which
 * is off by default.
 */
test.describe('In-app notifications arrive live', () => {
  test('a notification inserted while the page is open appears in the bell without a reload', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'notif-live' });

    const joined = new Promise<void>((resolve) => {
      page.on('websocket', (socket) => {
        socket.on('framereceived', ({ payload }) => {
          if (String(payload).includes('Subscribed to PostgreSQL')) resolve();
        });
      });
    });

    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/settings`);

    const bell = byTest(page, 'notifications-bell');

    await expect(bell).toBeVisible();
    await expect(byTest(page, 'notifications-count')).toBeHidden();

    // The insert must follow the join, or the first event is missed for a
    // reason unrelated to auth. A channel that never confirms the join is the
    // bug itself, so the wait is capped and the count assertion reports it.
    await Promise.race([
      joined,
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);

    for (const body of [
      'First live notification',
      'Second live notification',
    ]) {
      await insertRow(
        'notifications',
        { account_id: team.accountId, body, type: 'info', channel: 'in_app' },
        serviceRoleAuth(),
      );

      // The second insert is the one that shows the channel is still alive
      // after the first event, not only that one slipped through.
      await expect(byTest(page, 'notifications-count')).toHaveText(
        body.startsWith('First') ? '1' : '2',
      );
    }

    await bell.click();

    await expect(byTest(page, 'notification-item')).toHaveCount(2);
    await expect(byTest(page, 'notification-item').first()).toContainText(
      'Second live notification',
    );
  });
});
