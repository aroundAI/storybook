import 'server-only';

import { getAccountDashboardDataService } from '@kit/content-analytics/server/account-dashboard-actions';

import { defineTool } from '../../../registry';
import {
  READ_ONLY,
  analyticsNotes,
  callService,
  dateRangeArgs,
  windowOf,
} from './shared';

/**
 * The account home (`/home/[account]`): totals against the previous period,
 * the platform split, the daily series, top content and production status.
 * With ClickHouse off the totals are null: not measured, never zero.
 */
export const getAccountOverview = defineTool({
  name: 'get_account_overview',
  title: 'Account overview',
  description:
    'The team dashboard: views, engagement and revenue totals for the window against the previous period, the platform split, the daily series, top content and production status. Figures that could not be measured are null, with the reason in `notes`.',
  inputSchema: { ...dateRangeArgs },
  scope: 'studio:read',
  annotations: READ_ONLY,
  async handler(input, context) {
    const window = windowOf(input);
    const accountId = context.accountId;

    const [data, notes] = await Promise.all([
      callService(() =>
        getAccountDashboardDataService(context.principal.supabase, {
          accountId,
          startDate: window.fromDate,
          endDate: window.toDate,
        }),
      ),
      analyticsNotes(context, { accountId }, window),
    ]);

    return { structuredContent: { data, notes } };
  },
});
