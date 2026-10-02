import 'server-only';

import { GetAnalyticsSettingsSchema } from '@kit/content-analytics/lib/schemas/settings';
import { getAnalyticsSettingsService } from '@kit/content-analytics/server/settings-service';

import { defineTool } from '../../../registry';
import { READ_ONLY, callService, parseWith } from './shared';

/** The analytics settings page (FILM-1608), read-only. */
export const getAnalyticsSettings = defineTool({
  name: 'get_analytics_settings',
  title: 'Analytics settings',
  description:
    'The team’s analytics settings: the YPP watch-hour and subscriber targets and the tag-median sample size, and each active YouTube channel’s overrides and applicant status. Read-only; changes are made in the web app.',
  inputSchema: {},
  scope: 'studio:read',
  annotations: READ_ONLY,
  async handler(_input, context) {
    const data = await callService(() =>
      getAnalyticsSettingsService(
        context.principal.supabase,
        parseWith(GetAnalyticsSettingsSchema, { accountId: context.accountId }),
      ),
    );

    return { structuredContent: { data } };
  },
});
