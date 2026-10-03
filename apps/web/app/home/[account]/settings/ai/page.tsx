import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageBody } from '@kit/ui/page';
import { Trans } from '@kit/ui/trans';

import { createI18nServerInstance } from '~/lib/i18n/i18n.server';
import { withI18n } from '~/lib/i18n/with-i18n';

import { TeamAccountLayoutPageHeader } from '../../_components/team-account-layout-page-header';
import { loadTeamWorkspace } from '../../_lib/server/team-account-workspace.loader';
import { AiSettingsForm } from './_components/ai-settings-form';
import {
  AI_SETTINGS_DEFAULTS,
  AiSettingsSchema,
} from './_lib/schemas/ai-settings.schema';

export const generateMetadata = async () => {
  const i18n = await createI18nServerInstance();
  const title = i18n.t('common:routes.aiSettings', { defaultValue: 'AI' });

  return { title };
};

interface PageProps {
  params: Promise<{ account: string }>;
}

/**
 * Team settings → AI (FILM-1910): which generation modes the team allows,
 * and its default. Owners edit; members see the same page read-only.
 */
async function AiSettingsPage(props: PageProps) {
  const slug = (await props.params).account;
  const workspace = await loadTeamWorkspace(slug);
  const accountId = workspace.account.id;
  const client = getSupabaseServerClient();

  const [{ data: row, error }, { data: isOwner }] = await Promise.all([
    client
      .from('account_ai_settings')
      .select(
        'server_generation_enabled, external_generation_enabled, default_mode, performance_context_enabled, daily_llm_spend_cap_usd',
      )
      .eq('account_id', accountId)
      .maybeSingle(),
    // the same check as the table's write policies
    client.rpc('has_role_on_account', {
      account_id: accountId,
      account_role: 'owner',
    }),
  ]);

  if (error) {
    throw new Error(`Could not read the team's AI settings: ${error.message}`);
  }

  // A team with no row has the defaults (FILM-1903)
  const settings = row
    ? AiSettingsSchema.parse({
        serverGenerationEnabled: row.server_generation_enabled,
        externalGenerationEnabled: row.external_generation_enabled,
        defaultMode: row.default_mode,
        performanceContextEnabled: row.performance_context_enabled,
        dailyLlmSpendCapUsd: row.daily_llm_spend_cap_usd,
      })
    : AI_SETTINGS_DEFAULTS;

  return (
    <>
      <TeamAccountLayoutPageHeader
        account={slug}
        title={<Trans i18nKey="common:routes.aiSettings" defaults="AI" />}
        description={<AppBreadcrumbs />}
      />

      <PageBody>
        <div className="flex max-w-3xl flex-1 flex-col space-y-6">
          <p className="text-sm text-muted-foreground">
            StoryBook can write each stage itself with Gemini, or let a
            connected app such as Claude write it over MCP. Choose which the
            team allows. Content shows which one wrote it.
          </p>

          <AiSettingsForm
            accountSlug={slug}
            settings={settings}
            canEdit={isOwner === true}
          />
        </div>
      </PageBody>
    </>
  );
}

export default withI18n(AiSettingsPage);
