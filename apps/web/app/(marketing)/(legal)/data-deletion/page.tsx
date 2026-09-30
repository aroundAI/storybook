import Link from 'next/link';

import { Clock, ExternalLink, Mail, Trash2, Unplug, UserX } from 'lucide-react';

import { PLATFORM_ACCESS_SETTINGS } from '@kit/publishing/components/platform-access-settings';

import { SitePageHeader } from '~/(marketing)/_components/site-page-header';
import { createI18nServerInstance } from '~/lib/i18n/i18n.server';
import { withI18n } from '~/lib/i18n/with-i18n';

export async function generateMetadata() {
  const { t } = await createI18nServerInstance();

  return {
    title: t('marketing:dataDeletion'),
    description: t('marketing:dataDeletionDescription'),
  };
}

async function DataDeletionPage() {
  const { t } = await createI18nServerInstance();
  const lastUpdated = 'September 24, 2026';
  const companyName = 'Around AI Limited';
  const productName = 'StoryBook';
  const contactEmail = 'privacy@storybook.digital';

  return (
    <div
      data-test="data-deletion-page"
      className="bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900"
    >
      <SitePageHeader
        title={t('marketing:dataDeletion')}
        subtitle={t('marketing:dataDeletionDescription')}
      />

      <div className="container mx-auto max-w-4xl px-4 py-12">
        <div className="mb-8 flex items-center justify-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
            <Clock className="h-4 w-4" />
            Last updated: {lastUpdated}
          </div>
        </div>

        <div className="space-y-8">
          <Section
            id="request"
            icon={Trash2}
            title="1. Ask us to delete your data"
          >
            <div className="space-y-4">
              <p>
                Email{' '}
                <ContactLink
                  email={contactEmail}
                  dataTest="data-deletion-contact"
                />{' '}
                from the address on your {productName} account and tell us what
                you want deleted: everything we hold about you, or only the data
                we received from one connected platform (YouTube, Instagram,
                Facebook, TikTok, X or LinkedIn).
              </p>
              <p>
                There is no button for this yet. A person at {companyName}{' '}
                deletes the data by hand and replies to confirm when it is done,
                within 7 calendar days of your request.
              </p>
              <p>
                A request covers the connection and its access tokens, our
                records of what you published through it, revenue figures
                imported from the platform, and the per-video statistics we
                collected from it: each video&apos;s title, tags and publish
                date, views, watch time, likes, comments, shares, saves,
                subscriber counts, impressions, audience breakdowns (age group,
                gender, country, device, follower status), traffic sources and
                retention curves.
              </p>
              <p>
                Deleting data held by {productName} does not change anything on
                the platform itself. Your videos, posts and statistics on
                YouTube, Instagram, Facebook, TikTok, X or LinkedIn stay where
                they are. To delete those, use that platform&apos;s own app or
                website.
              </p>
            </div>
          </Section>

          <Section
            id="disconnect"
            icon={Unplug}
            title="2. Disconnect a platform"
          >
            <div className="space-y-4">
              <p>
                In your team&apos;s <strong>Settings → Platforms</strong>,
                choose <strong>Disconnect</strong> next to the account.
              </p>
              <ul className="list-disc space-y-2 pl-5">
                <li data-test="disconnect-revokes">
                  For YouTube, TikTok, Instagram, Facebook and X we ask the
                  platform to revoke {productName}&apos;s access, then delete
                  the access tokens we stored. If the platform does not confirm
                  the revoke, the tokens are still deleted here and we tell you
                  so, with a link to the platform&apos;s settings; use the links
                  in section 4 to check that we no longer appear.
                </li>
                <li data-test="disconnect-linkedin">
                  LinkedIn does not let apps revoke their own access, so for
                  LinkedIn we delete the stored tokens and you remove{' '}
                  {productName} at LinkedIn as well, using the link in section
                  4.
                </li>
                <li>
                  From that moment we collect nothing further from that account.
                </li>
              </ul>

              <p data-test="retention-disconnect">
                Disconnecting keeps your own records: what was published through
                that account, revenue you entered, tags, experiments and channel
                targets all stay, and reconnecting the same account attaches
                them to it again. The statistics already collected from the
                platform are kept until you ask us to delete them (section 1),
                with one exception: YouTube&apos;s API policies require us to
                delete the YouTube statistics we hold within 7 calendar days of
                a disconnect, so for YouTube that is what happens.
              </p>
            </div>
          </Section>

          <Section id="account" icon={UserX} title="3. Delete your account">
            <div className="space-y-4">
              <p>
                To delete your own account, open{' '}
                <strong>Settings → Danger Zone → Delete your Account</strong>.
                To delete a team, its primary owner opens the team&apos;s{' '}
                <strong>Settings → Danger Zone</strong>.
              </p>
              <ul className="list-disc space-y-2 pl-5">
                <li>
                  This immediately removes the account from our main database,
                  together with its platform connections and their tokens, our
                  records of what was published through them, and its revenue
                  entries.
                </li>
                <li>
                  It does not contact the platforms. Disconnect each platform
                  first (section 2), or revoke access at the platform (section
                  4).
                </li>
                <li>
                  Within 7 calendar days it also removes the per-video
                  statistics described in section 1, which are held in a
                  separate analytics store.
                </li>
                <li data-test="deletion-account-reports">
                  Within 7 calendar days it also removes the account&apos;s
                  report files: the reports you exported and the ones your
                  schedules emailed. Otherwise we keep them until you ask us to
                  delete them.
                </li>
                <li>
                  If deleting fails, or you can no longer sign in, email us and
                  we will delete the account for you.
                </li>
              </ul>
            </div>
          </Section>

          <Section
            id="revoke"
            icon={ExternalLink}
            title="4. Revoke access at the platform"
          >
            <div className="space-y-4">
              <p>
                You can remove {productName}&apos;s access from the
                platform&apos;s side at any time, whether or not you still have
                a {productName} account. Access stops immediately.
              </p>
              <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-slate-900 dark:text-white">
                        Platform
                      </th>
                      <th className="px-4 py-3 text-left font-medium text-slate-900 dark:text-white">
                        Where
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {Object.values(PLATFORM_ACCESS_SETTINGS).map((item) => (
                      <tr
                        key={item.id}
                        className="bg-white dark:bg-slate-800/50"
                      >
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                          {item.label}
                        </td>
                        {item.href ? (
                          <td className="px-4 py-3">
                            <a
                              data-test={`revoke-link-${item.id}`}
                              href={item.href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-indigo-600 underline dark:text-indigo-400"
                            >
                              {item.where}
                            </a>
                          </td>
                        ) : (
                          <td
                            data-test={`revoke-path-${item.id}`}
                            className="px-4 py-3"
                          >
                            {item.where}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p data-test="retention-revoked">
                Revoking at the platform stops us collecting anything further,
                but by itself deletes nothing here: the connection stays in{' '}
                <strong>Settings → Platforms</strong> until you disconnect it
                there (section 2), and the statistics already collected are kept
                until you ask (section 1). YouTube is the exception: if you
                revoke access at Google, or your YouTube authorisation lapses
                and cannot be renewed, we delete the YouTube statistics we hold
                within 30 calendar days.
              </p>
            </div>
          </Section>

          <div className="rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-violet-50 p-8 text-center dark:border-indigo-800 dark:from-indigo-900/20 dark:to-violet-900/20">
            <Mail className="mx-auto mb-4 h-8 w-8 text-indigo-500" />
            <h3 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">
              Anything else
            </h3>
            <p className="mb-4 text-slate-600 dark:text-slate-400">
              Questions or complaints about how {companyName} handles your data
              go to the same address. The{' '}
              <Link
                href="/privacy-policy"
                className="text-indigo-600 underline dark:text-indigo-400"
              >
                Privacy Policy
              </Link>{' '}
              says what we collect and why.
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

function ContactLink({
  email,
  dataTest,
}: {
  email: string;
  dataTest?: string;
}) {
  return (
    <a
      data-test={dataTest}
      href={`mailto:${email}`}
      className="text-indigo-600 underline dark:text-indigo-400"
    >
      {email}
    </a>
  );
}

function Section({
  id,
  icon: Icon,
  title,
  children,
}: React.PropsWithChildren<{
  id: string;
  icon: React.ElementType;
  title: string;
}>) {
  return (
    <section
      id={id}
      className="scroll-mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800/50"
    >
      <h2 className="mb-4 flex items-center gap-3 text-xl font-semibold text-slate-900 dark:text-white">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">
          <Icon className="h-5 w-5" />
        </span>
        {title}
      </h2>
      <div className="text-slate-600 dark:text-slate-400">{children}</div>
    </section>
  );
}

export default withI18n(DataDeletionPage);
