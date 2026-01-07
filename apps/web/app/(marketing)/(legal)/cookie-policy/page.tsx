import { SitePageHeader } from '~/(marketing)/_components/site-page-header';
import { createI18nServerInstance } from '~/lib/i18n/i18n.server';
import { withI18n } from '~/lib/i18n/with-i18n';
import {
  Cookie,
  Shield,
  Settings,
  BarChart3,
  Share2,
  Clock,
  HardDrive,
  Sliders,
  ExternalLink,
  Mail,
  FileText,
  AlertCircle,
} from 'lucide-react';

export async function generateMetadata() {
  const { t } = await createI18nServerInstance();

  return {
    title: t('marketing:cookiePolicy'),
  };
}

async function CookiePolicyPage() {
  const { t } = await createI18nServerInstance();
  const lastUpdated = 'January 7, 2025';
  const productName = 'StoryBook';
  const website = 'storybook.digital';
  const contactEmail = 'privacy@storybook.digital';

  return (
    <div className="bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <SitePageHeader
        title={t(`marketing:cookiePolicy`)}
        subtitle={t(`marketing:cookiePolicyDescription`)}
      />

      <div className="container mx-auto max-w-4xl px-4 py-12">
        {/* Last Updated Badge */}
        <div className="mb-8 flex items-center justify-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
            <Clock className="h-4 w-4" />
            Last updated: {lastUpdated}
          </div>
        </div>

        {/* Cookie Summary Cards */}
        <div className="mb-12 grid gap-4 md:grid-cols-4">
          {[
            { icon: Shield, label: 'Essential', count: 4, color: 'emerald', desc: 'Always on' },
            { icon: Settings, label: 'Functional', count: 3, color: 'blue', desc: 'Preferences' },
            { icon: BarChart3, label: 'Analytics', count: 2, color: 'purple', desc: 'Usage data' },
            { icon: Share2, label: 'Third-Party', count: 3, color: 'amber', desc: 'External services' },
          ].map((item, i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800/50">
              <div className={`mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-${item.color}-100 dark:bg-${item.color}-900/30`}>
                <item.icon className={`h-6 w-6 text-${item.color}-600 dark:text-${item.color}-400`} />
              </div>
              <p className="font-semibold text-slate-900 dark:text-white">{item.label}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">{item.desc}</p>
            </div>
          ))}
        </div>

        {/* Table of Contents */}
        <div className="mb-12 rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800/50">
          <h3 className="mb-4 flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
            <FileText className="h-5 w-5 text-indigo-500" />
            Table of Contents
          </h3>
          <div className="grid gap-2 text-sm md:grid-cols-2">
            {[
              'What Are Cookies?',
              'Essential Cookies',
              'Functional Cookies',
              'Analytics Cookies',
              'Third-Party Cookies',
              'Local Storage',
              'Managing Cookies',
              'Contact Us',
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
          {/* What Are Cookies */}
          <Section id="section-1" icon={Cookie} title="1. What Are Cookies?" color="amber">
            <p>
              Cookies are small text files stored on your device when you visit a website.
              They help websites remember your preferences, understand how you use the site,
              and provide a personalized experience. {productName} uses cookies and similar
              technologies to operate and improve our Service.
            </p>
          </Section>

          {/* Essential Cookies */}
          <Section id="section-2" icon={Shield} title="2. Essential Cookies" color="emerald">
            <div className="mb-4 flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-900/20">
              <AlertCircle className="mt-0.5 h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <p className="text-sm text-emerald-700 dark:text-emerald-300">
                These cookies are necessary for the Service to function and <strong>cannot be disabled</strong>.
              </p>
            </div>
            <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-slate-900 dark:text-white">Cookie</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-900 dark:text-white">Purpose</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-900 dark:text-white">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {[
                    ['sb-access-token', 'Keeps you signed in', 'Session / 7 days'],
                    ['sb-refresh-token', 'Refreshes your session', '7 days'],
                    ['__Host-csrf-token', 'Prevents cross-site attacks', 'Session'],
                    ['supabase-auth-token', 'Authentication state', 'Session'],
                  ].map(([name, purpose, duration], i) => (
                    <tr key={i} className="bg-white dark:bg-slate-800/50">
                      <td className="px-4 py-3">
                        <code className="rounded bg-slate-100 px-2 py-1 text-xs font-mono text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                          {name}
                        </code>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{purpose}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-400">
                          <Clock className="h-3 w-3" />
                          {duration}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* Functional Cookies */}
          <Section id="section-3" icon={Settings} title="3. Functional Cookies" color="blue">
            <p className="mb-4">These cookies enable enhanced functionality and personalization.</p>
            <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-slate-900 dark:text-white">Cookie</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-900 dark:text-white">Purpose</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-900 dark:text-white">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {[
                    ['theme', 'Light/dark mode preference', '1 year'],
                    ['locale', 'Language preference', '1 year'],
                    ['sidebar-collapsed', 'Sidebar state', '1 year'],
                  ].map(([name, purpose, duration], i) => (
                    <tr key={i} className="bg-white dark:bg-slate-800/50">
                      <td className="px-4 py-3">
                        <code className="rounded bg-slate-100 px-2 py-1 text-xs font-mono text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                          {name}
                        </code>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{purpose}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-400">
                          <Clock className="h-3 w-3" />
                          {duration}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* Analytics Cookies */}
          <Section id="section-4" icon={BarChart3} title="4. Analytics Cookies" color="purple">
            <p className="mb-4">These cookies help us understand how visitors interact with the Service.</p>
            <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-slate-900 dark:text-white">Cookie</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-900 dark:text-white">Provider</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-900 dark:text-white">Purpose</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-900 dark:text-white">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {[
                    ['_ga', 'Google Analytics', 'Unique visitor ID', '2 years'],
                    ['_gid', 'Google Analytics', 'Session tracking', '24 hours'],
                  ].map(([name, provider, purpose, duration], i) => (
                    <tr key={i} className="bg-white dark:bg-slate-800/50">
                      <td className="px-4 py-3">
                        <code className="rounded bg-slate-100 px-2 py-1 text-xs font-mono text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                          {name}
                        </code>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{provider}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{purpose}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-400">
                          <Clock className="h-3 w-3" />
                          {duration}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* Third-Party Cookies */}
          <Section id="section-5" icon={Share2} title="5. Third-Party Cookies" color="amber">
            <p className="mb-4">
              When you connect external platforms, those services may set their own cookies:
            </p>
            <div className="grid gap-3 md:grid-cols-3">
              {[
                { name: 'YouTube', desc: 'Video embedding & publishing' },
                { name: 'Stripe', desc: 'Payment fraud prevention' },
                { name: 'Sentry', desc: 'Error tracking' },
              ].map((item, i) => (
                <div key={i} className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                  <p className="font-medium text-slate-900 dark:text-white">{item.name}</p>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{item.desc}</p>
                </div>
              ))}
            </div>
            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
              We have no control over third-party cookies. Please refer to each provider&apos;s cookie policy.
            </p>
          </Section>

          {/* Local Storage */}
          <Section id="section-6" icon={HardDrive} title="6. Local & Session Storage" color="cyan">
            <p className="mb-4">In addition to cookies, we use browser storage technologies:</p>
            <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-slate-900 dark:text-white">Key</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-900 dark:text-white">Type</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-900 dark:text-white">Purpose</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {[
                    ['supabase.auth.token', 'Local Storage', 'Authentication state'],
                    ['react-query-cache', 'Session Storage', 'API response caching'],
                    ['workspace-preferences', 'Local Storage', 'Workspace settings'],
                  ].map(([key, type, purpose], i) => (
                    <tr key={i} className="bg-white dark:bg-slate-800/50">
                      <td className="px-4 py-3">
                        <code className="rounded bg-slate-100 px-2 py-1 text-xs font-mono text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                          {key}
                        </code>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-1 text-xs font-medium ${type === 'Local Storage' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'}`}>
                          {type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* Managing Cookies */}
          <Section id="section-7" icon={Sliders} title="7. Managing Cookies" color="slate">
            <div className="space-y-6">
              <div>
                <h4 className="mb-3 font-medium text-slate-900 dark:text-white">Browser Settings</h4>
                <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
                  Most browsers allow you to manage cookies through their settings:
                </p>
                <div className="grid gap-2 md:grid-cols-2">
                  {[
                    { browser: 'Chrome', path: 'Settings → Privacy and Security → Cookies' },
                    { browser: 'Firefox', path: 'Options → Privacy & Security → Cookies' },
                    { browser: 'Safari', path: 'Preferences → Privacy → Cookies' },
                    { browser: 'Edge', path: 'Settings → Privacy → Cookies' },
                  ].map((item, i) => (
                    <div key={i} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                      <p className="font-medium text-slate-900 dark:text-white">{item.browser}</p>
                      <p className="text-sm text-slate-600 dark:text-slate-400">{item.path}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="mb-3 font-medium text-slate-900 dark:text-white">Consequences of Disabling</h4>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    <strong>Warning:</strong> Disabling essential cookies may cause inability to sign in,
                    loss of settings, and reduced functionality.
                  </p>
                </div>
              </div>

              <div>
                <h4 className="mb-3 font-medium text-slate-900 dark:text-white">Opt-Out Links</h4>
                <a
                  href="https://tools.google.com/dlpage/gaoptout"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <ExternalLink className="h-4 w-4" />
                  Google Analytics Opt-out Browser Add-on
                </a>
              </div>
            </div>
          </Section>

          {/* Contact Section */}
          <div className="rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-violet-50 p-8 text-center dark:border-indigo-800 dark:from-indigo-900/20 dark:to-violet-900/20">
            <Mail className="mx-auto mb-4 h-8 w-8 text-indigo-500" />
            <h3 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">Questions about Cookies?</h3>
            <p className="mb-4 text-slate-600 dark:text-slate-400">
              If you have questions about our use of cookies, please contact us.
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
    amber: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
    emerald: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
    blue: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
    purple: 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400',
    cyan: 'bg-cyan-100 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-400',
    slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  };

  return (
    <section id={id} className="scroll-mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800/50">
      <h2 className="mb-4 flex items-center gap-3 text-xl font-semibold text-slate-900 dark:text-white">
        <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${colorClasses[color]}`}>
          <Icon className="h-5 w-5" />
        </span>
        {title}
      </h2>
      <div className="text-slate-600 dark:text-slate-400">
        {children}
      </div>
    </section>
  );
}

export default withI18n(CookiePolicyPage);
