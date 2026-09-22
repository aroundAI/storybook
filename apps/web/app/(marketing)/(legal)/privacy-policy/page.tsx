import Link from 'next/link';

import {
  AlertCircle,
  Clock,
  Database,
  Eye,
  FileText,
  Globe,
  Lock,
  Mail,
  Server,
  Share2,
  Shield,
  Sparkles,
  Trash2,
  UserCheck,
} from 'lucide-react';

import { SitePageHeader } from '~/(marketing)/_components/site-page-header';
import { createI18nServerInstance } from '~/lib/i18n/i18n.server';
import { withI18n } from '~/lib/i18n/with-i18n';

export async function generateMetadata() {
  const { t } = await createI18nServerInstance();

  return {
    title: t('marketing:privacyPolicy'),
  };
}

async function PrivacyPolicyPage() {
  const { t } = await createI18nServerInstance();
  const lastUpdated = 'September 22, 2026';
  const companyName = 'Around AI Limited';
  const productName = 'StoryBook';
  const contactEmail = 'privacy@storybook.digital';

  return (
    <div className="bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <SitePageHeader
        title={t('marketing:privacyPolicy')}
        subtitle={t('marketing:privacyPolicyDescription')}
      />

      <div className="container mx-auto max-w-4xl px-4 py-12">
        {/* Last Updated Badge */}
        <div className="mb-8 flex items-center justify-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
            <Clock className="h-4 w-4" />
            Last updated: {lastUpdated}
          </div>
        </div>

        {/* Quick Summary */}
        <div className="mb-12 rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-violet-50 p-6 dark:border-indigo-800 dark:from-indigo-900/20 dark:to-violet-900/20">
          <h3 className="mb-4 flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
            <Shield className="h-5 w-5 text-indigo-500" />
            Privacy at a Glance
          </h3>
          <div className="grid gap-4 text-sm md:grid-cols-3">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-green-100 p-2 dark:bg-green-900/30">
                <Lock className="h-4 w-4 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="font-medium text-slate-900 dark:text-white">
                  Encrypted
                </p>
                <p className="text-slate-600 dark:text-slate-400">
                  All data encrypted in transit and at rest
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-blue-100 p-2 dark:bg-blue-900/30">
                <UserCheck className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="font-medium text-slate-900 dark:text-white">
                  Your Rights
                </p>
                <p className="text-slate-600 dark:text-slate-400">
                  GDPR & CCPA compliant access controls
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-purple-100 p-2 dark:bg-purple-900/30">
                <Sparkles className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="font-medium text-slate-900 dark:text-white">
                  AI Transparency
                </p>
                <p className="text-slate-600 dark:text-slate-400">
                  We disclose all AI data processing
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Table of Contents */}
        <div className="mb-12 rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800/50">
          <h3 className="mb-4 flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
            <FileText className="h-5 w-5 text-indigo-500" />
            Table of Contents
          </h3>
          <div className="grid gap-2 text-sm md:grid-cols-2">
            {[
              'Information We Collect',
              'How We Use Your Information',
              'AI Processing',
              'Data Sharing',
              'Data Retention',
              'Your Rights',
              'Data Security',
              'International Transfers',
            ].map((item, i) => (
              <a
                key={i}
                href={`#section-${i + 1}`}
                className="flex items-center gap-2 text-slate-600 transition-colors hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded bg-slate-100 text-xs font-medium dark:bg-slate-700">
                  {i + 1}
                </span>
                {item}
              </a>
            ))}
          </div>
        </div>

        {/* Content Sections */}
        <div className="space-y-8">
          {/* Introduction */}
          <Section
            id="section-intro"
            icon={Shield}
            title="Introduction"
            color="indigo"
          >
            <p>
              {companyName} (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;)
              respects your privacy and is committed to protecting your personal
              data. This Privacy Policy explains how we collect, use, disclose,
              and safeguard your information when you use {productName}.
            </p>
          </Section>

          {/* Section 1: Data Collection */}
          <Section
            id="section-1"
            icon={Database}
            title="1. Information We Collect"
            color="blue"
          >
            <div className="space-y-6">
              <div>
                <h4 className="mb-3 font-medium text-slate-900 dark:text-white">
                  1.1 Information You Provide
                </h4>
                <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-800">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-slate-900 dark:text-white">
                          Data Type
                        </th>
                        <th className="px-4 py-3 text-left font-medium text-slate-900 dark:text-white">
                          Purpose
                        </th>
                        <th className="px-4 py-3 text-left font-medium text-slate-900 dark:text-white">
                          Legal Basis
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                      {[
                        [
                          'Account Info (email, name)',
                          'Authentication',
                          'Contract',
                        ],
                        [
                          'Profile (avatar, preferences)',
                          'Personalization',
                          'Consent',
                        ],
                        ['Payment Information', 'Billing', 'Contract'],
                        [
                          'User Content (stories, media)',
                          'Service delivery',
                          'Contract',
                        ],
                      ].map(([type, purpose, basis], i) => (
                        <tr key={i} className="bg-white dark:bg-slate-800/50">
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                            {type}
                          </td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                            {purpose}
                          </td>
                          <td className="px-4 py-3">
                            <span className="rounded-full bg-indigo-100 px-2 py-1 text-xs font-medium text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
                              {basis}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h4 className="mb-3 font-medium text-slate-900 dark:text-white">
                  1.2 Information Collected Automatically
                </h4>
                <div className="grid gap-3 md:grid-cols-2">
                  {[
                    {
                      icon: Server,
                      label: 'Device Info',
                      desc: 'Browser, OS, device identifiers',
                    },
                    {
                      icon: Eye,
                      label: 'Usage Data',
                      desc: 'Pages visited, features used',
                    },
                    {
                      icon: Globe,
                      label: 'Log Data',
                      desc: 'IP address, access times',
                    },
                    {
                      icon: Database,
                      label: 'Cookies',
                      desc: 'See Cookie Policy',
                    },
                  ].map((item, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700"
                    >
                      <item.icon className="h-5 w-5 text-slate-400" />
                      <div>
                        <p className="font-medium text-slate-900 dark:text-white">
                          {item.label}
                        </p>
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                          {item.desc}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="mb-3 font-medium text-slate-900 dark:text-white">
                  1.3 Information from Third Parties
                </h4>
                <div className="space-y-3">
                  <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                    <p className="mb-2 font-medium text-slate-900 dark:text-white">
                      OAuth Providers (Google, GitHub)
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      Basic profile information for sign-in
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                    <p className="mb-2 font-medium text-slate-900 dark:text-white">
                      Social Platforms (YouTube, TikTok, Instagram, Facebook)
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      Account name, profile picture, channel IDs, analytics
                      data, follower counts
                    </p>
                    <p
                      data-test="privacy-youtube-api-services"
                      className="mt-3 text-sm text-slate-600 dark:text-slate-400"
                    >
                      {productName} uses YouTube API Services to connect your
                      YouTube channel, publish to it and read its statistics.
                      Your use of YouTube through {productName} is also covered
                      by the{' '}
                      <ExternalPolicyLink
                        dataTest="privacy-youtube-terms-link"
                        href="https://www.youtube.com/t/terms"
                      >
                        YouTube Terms of Service
                      </ExternalPolicyLink>
                      , and Google&apos;s handling of your data by the{' '}
                      <ExternalPolicyLink
                        dataTest="privacy-google-privacy-link"
                        href="https://www.google.com/policies/privacy"
                      >
                        Google Privacy Policy
                      </ExternalPolicyLink>
                      .
                    </p>
                  </div>
                </div>
              </div>

              <div data-test="privacy-platform-data">
                <h4 className="mb-3 font-medium text-slate-900 dark:text-white">
                  1.4 What We Keep from Connected Platforms
                </h4>
                <div className="space-y-3 text-sm">
                  <p>
                    <strong>What.</strong> The account&apos;s name, profile
                    picture and channel or page ID; the access tokens the
                    platform issues, encrypted; and the statistics the platform
                    reports for your channel and your videos: titles, tags and
                    publish dates, views, watch time, likes, comments, shares,
                    saves, subscriber counts, impressions, audience breakdowns
                    (age group, gender, country, device, follower status),
                    traffic sources, retention curves and, where the platform
                    reports it, revenue.
                  </p>
                  <p>
                    <strong>Why.</strong> To publish to the account when you ask
                    us to, and to show you and the members of your team how your
                    channel and videos perform, in the app and in any reports
                    you schedule. If you use AI Insights, the figures on that
                    page are sent to one of the AI providers listed in section 3
                    to write the summary.
                  </p>
                  <p data-test="privacy-retention">
                    <strong>How long.</strong> While the platform stays
                    connected we refresh these figures on a schedule, and each
                    scheduled refresh confirms that your authorisation is still
                    valid. After you disconnect a platform, or revoke our access
                    at the platform, we keep the statistics already collected
                    until you ask us to delete them, with no time limit — except
                    for YouTube: YouTube&apos;s API policies require us to
                    delete YouTube statistics within 7 calendar days of a
                    disconnect in this app, and within 30 calendar days if you
                    revoke access at Google or your authorisation lapses and
                    cannot be renewed. Disconnecting also removes our records of
                    what was published through that account and their revenue
                    entries; the Data Deletion page below says exactly what
                    goes.
                  </p>
                  <p>
                    <strong>Deleting it.</strong> Our{' '}
                    <Link
                      data-test="privacy-data-deletion-link"
                      href="/data-deletion"
                      className="text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      Data Deletion
                    </Link>{' '}
                    page says how to disconnect a platform, delete your account,
                    or ask us to delete this data.
                  </p>
                </div>
              </div>
            </div>
          </Section>

          {/* Section 2: How We Use */}
          <Section
            id="section-2"
            icon={Eye}
            title="2. How We Use Your Information"
            color="violet"
          >
            <div className="grid gap-2 md:grid-cols-2">
              {[
                'Provide and maintain the Service',
                'Process transactions and subscriptions',
                'Send service-related communications',
                'Improve and personalize your experience',
                'Analyze usage patterns and trends',
                'Detect and prevent fraud or abuse',
                'Comply with legal obligations',
                'Publish content to connected platforms',
              ].map((item, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
                  {item}
                </div>
              ))}
            </div>
          </Section>

          {/* Section 3: AI Processing */}
          <Section
            id="section-3"
            icon={Sparkles}
            title="3. AI Processing"
            color="purple"
          >
            <div className="space-y-6">
              <div>
                <h4 className="mb-3 font-medium text-slate-900 dark:text-white">
                  3.1 AI Providers We Use
                </h4>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                    <p className="mb-1 font-medium text-slate-900 dark:text-white">
                      Language Models
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      OpenAI, Anthropic, Google Gemini, Deepseek
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                    <p className="mb-1 font-medium text-slate-900 dark:text-white">
                      Video Generation
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      Kling, Hailuo, Runway
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                    <p className="mb-1 font-medium text-slate-900 dark:text-white">
                      Voice Synthesis
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      ElevenLabs, PlayHT
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                    <p className="mb-1 font-medium text-slate-900 dark:text-white">
                      Music Generation
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      Suno
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/20">
                <div className="flex items-start gap-3">
                  <Lock className="mt-0.5 h-5 w-5 text-green-600 dark:text-green-400" />
                  <div>
                    <p className="font-medium text-green-800 dark:text-green-200">
                      Your Data Is Not Used for Training
                    </p>
                    <p className="mt-1 text-sm text-green-700 dark:text-green-300">
                      We use providers that do not train their models on your
                      data by default. Your content is processed solely to
                      provide the requested output.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </Section>

          {/* Section 4: Data Sharing */}
          <Section
            id="section-4"
            icon={Share2}
            title="4. Data Sharing"
            color="pink"
          >
            <div className="space-y-4">
              <h4 className="font-medium text-slate-900 dark:text-white">
                Service Providers
              </h4>
              <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-slate-900 dark:text-white">
                        Provider
                      </th>
                      <th className="px-4 py-3 text-left font-medium text-slate-900 dark:text-white">
                        Purpose
                      </th>
                      <th className="px-4 py-3 text-left font-medium text-slate-900 dark:text-white">
                        Location
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {[
                      ['Supabase', 'Database, Auth', 'AWS (US/EU)'],
                      ['AWS', 'Hosting, Storage', 'US'],
                      ['Stripe', 'Payments', 'US'],
                      ['Resend', 'Transactional emails', 'US'],
                      ['Sentry', 'Error tracking', 'US'],
                    ].map(([provider, purpose, location], i) => (
                      <tr key={i} className="bg-white dark:bg-slate-800/50">
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                          {provider}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                          {purpose}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                          {location}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Section>

          {/* Section 5: Data Retention */}
          <Section
            id="section-5"
            icon={Clock}
            title="5. Data Retention"
            color="amber"
          >
            <div className="grid gap-3 md:grid-cols-2">
              {[
                {
                  label: 'Account Data',
                  period: 'Active + 30 days',
                  color: 'blue',
                },
                {
                  label: 'User Content',
                  period: 'Until deleted',
                  color: 'green',
                },
                {
                  label: 'Analytics',
                  period: 'Until you ask — see 1.4',
                  color: 'purple',
                },
                {
                  label: 'Payment Records',
                  period: '7 years (legal)',
                  color: 'amber',
                },
                { label: 'Server Logs', period: '30 days', color: 'slate' },
              ].map((item, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg border border-slate-200 p-4 dark:border-slate-700"
                >
                  <span className="font-medium text-slate-900 dark:text-white">
                    {item.label}
                  </span>
                  <span
                    className={`rounded-full bg-${item.color}-100 px-3 py-1 text-xs font-medium text-${item.color}-700 dark:bg-${item.color}-900/30 dark:text-${item.color}-400`}
                  >
                    {item.period}
                  </span>
                </div>
              ))}
            </div>
          </Section>

          {/* Section 6: Your Rights */}
          <Section
            id="section-6"
            icon={UserCheck}
            title="6. Your Rights"
            color="emerald"
          >
            <div className="grid gap-3 md:grid-cols-2">
              {[
                {
                  icon: Eye,
                  right: 'Access',
                  desc: 'Request a copy of your data',
                },
                {
                  icon: FileText,
                  right: 'Rectification',
                  desc: 'Correct inaccurate data',
                },
                {
                  icon: Trash2,
                  right: 'Erasure',
                  desc: 'Request deletion of your data',
                },
                {
                  icon: Share2,
                  right: 'Portability',
                  desc: 'Receive data in structured format',
                },
                {
                  icon: AlertCircle,
                  right: 'Restriction',
                  desc: 'Limit how we process your data',
                },
                {
                  icon: Lock,
                  right: 'Withdraw Consent',
                  desc: 'Revoke consent at any time',
                },
              ].map((item, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 rounded-lg border border-slate-200 p-4 dark:border-slate-700"
                >
                  <div className="rounded-lg bg-emerald-100 p-2 dark:bg-emerald-900/30">
                    <item.icon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <p className="font-medium text-slate-900 dark:text-white">
                      {item.right}
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      {item.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">
              To exercise these rights, contact us at{' '}
              <a
                href={`mailto:${contactEmail}`}
                className="text-indigo-600 hover:underline dark:text-indigo-400"
              >
                {contactEmail}
              </a>
              . We will respond within 30 days.
            </p>
            <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">
              How to have data from a connected platform deleted is set out,
              step by step, on our{' '}
              <Link
                href="/data-deletion"
                className="text-indigo-600 hover:underline dark:text-indigo-400"
              >
                Data Deletion
              </Link>{' '}
              page. In addition to that, you can revoke {productName}&apos;s
              access to your Google and YouTube data at any time from the{' '}
              <ExternalPolicyLink
                dataTest="privacy-google-permissions-link"
                href="https://security.google.com/settings/security/permissions"
              >
                Google security settings page
              </ExternalPolicyLink>
              .
            </p>
          </Section>

          {/* Section 7: Security */}
          <Section
            id="section-7"
            icon={Lock}
            title="7. Data Security"
            color="cyan"
          >
            <div className="grid gap-3 md:grid-cols-2">
              {[
                'Encryption in transit (TLS 1.3) and at rest',
                'Row-Level Security (RLS) in database',
                'Regular security audits',
                'Access controls and authentication',
                'Secure credential storage',
                'OAuth tokens encrypted at rest',
              ].map((item, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400"
                >
                  <Lock className="h-4 w-4 text-cyan-500" />
                  {item}
                </div>
              ))}
            </div>
          </Section>

          {/* Section 8: International */}
          <Section
            id="section-8"
            icon={Globe}
            title="8. International Transfers"
            color="slate"
          >
            <p>
              Your data may be transferred to and processed in countries outside
              your jurisdiction, including the United States. We ensure
              appropriate safeguards are in place, including Standard
              Contractual Clauses where applicable.
            </p>
          </Section>

          {/* Contact Section */}
          <div className="rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-violet-50 p-8 text-center dark:border-indigo-800 dark:from-indigo-900/20 dark:to-violet-900/20">
            <Mail className="mx-auto mb-4 h-8 w-8 text-indigo-500" />
            <h3 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">
              Privacy Questions?
            </h3>
            <p className="mb-4 text-slate-600 dark:text-slate-400">
              For privacy-related inquiries, contact our team.
            </p>
            <a
              href={`mailto:${contactEmail}`}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white transition-colors hover:bg-indigo-700"
            >
              <Mail className="h-4 w-4" />
              {contactEmail}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function ExternalPolicyLink({
  href,
  dataTest,
  children,
}: React.PropsWithChildren<{ href: string; dataTest: string }>) {
  return (
    <a
      data-test={dataTest}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-indigo-600 hover:underline dark:text-indigo-400"
    >
      {children}
    </a>
  );
}

function Section({
  id,
  icon: Icon,
  title,
  color,
  children,
}: {
  id: string;
  icon: React.ElementType;
  title: string;
  color: string;
  children: React.ReactNode;
}) {
  const colorClasses: Record<string, string> = {
    indigo:
      'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400',
    violet:
      'bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400',
    blue: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
    purple:
      'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400',
    pink: 'bg-pink-100 text-pink-600 dark:bg-pink-900/30 dark:text-pink-400',
    emerald:
      'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
    amber:
      'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
    cyan: 'bg-cyan-100 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-400',
    slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  };

  return (
    <section
      id={id}
      className="scroll-mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800/50"
    >
      <h2 className="mb-4 flex items-center gap-3 text-xl font-semibold text-slate-900 dark:text-white">
        <span
          className={`flex h-10 w-10 items-center justify-center rounded-lg ${colorClasses[color]}`}
        >
          <Icon className="h-5 w-5" />
        </span>
        {title}
      </h2>
      <div className="text-slate-600 dark:text-slate-400">{children}</div>
    </section>
  );
}

export default withI18n(PrivacyPolicyPage);
