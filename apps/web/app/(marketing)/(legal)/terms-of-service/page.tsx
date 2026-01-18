import {
  AlertTriangle,
  Ban,
  Clock,
  CreditCard,
  FileText,
  Globe,
  Mail,
  Scale,
  Share2,
  Shield,
  Sparkles,
  Users,
} from 'lucide-react';

import { SitePageHeader } from '~/(marketing)/_components/site-page-header';
import { createI18nServerInstance } from '~/lib/i18n/i18n.server';
import { withI18n } from '~/lib/i18n/with-i18n';

export async function generateMetadata() {
  const { t } = await createI18nServerInstance();

  return {
    title: t('marketing:termsOfService'),
  };
}

async function TermsOfServicePage() {
  const { t } = await createI18nServerInstance();
  const lastUpdated = 'January 7, 2025';
  const companyName = 'Around AI Limited';
  const productName = 'StoryBook';
  const contactEmail = 'legal@storybook.digital';

  return (
    <div className="bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <SitePageHeader
        title={t(`marketing:termsOfService`)}
        subtitle={t(`marketing:termsOfServiceDescription`)}
      />

      <div className="container mx-auto max-w-4xl px-4 py-12">
        {/* Last Updated Badge */}
        <div className="mb-8 flex items-center justify-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
            <Clock className="h-4 w-4" />
            Last updated: {lastUpdated}
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
              'Agreement to Terms',
              'Description of Service',
              'Account Registration',
              'User Content',
              'Third-Party Integrations',
              'Payment and Billing',
              'Intellectual Property',
              'Limitation of Liability',
              'Termination',
              'Governing Law',
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
          {/* Section 1 */}
          <Section
            id="section-1"
            icon={Scale}
            title="1. Agreement to Terms"
            color="indigo"
          >
            <p>
              By accessing or using {productName} (&quot;the Service&quot;),
              operated by {companyName}
              (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;), you agree to
              be bound by these Terms of Service (&quot;Terms&quot;). If you
              disagree with any part of these terms, you may not access the
              Service.
            </p>
          </Section>

          {/* Section 2 */}
          <Section
            id="section-2"
            icon={Sparkles}
            title="2. Description of Service"
            color="violet"
          >
            <p className="mb-4">
              {productName} is an AI-powered content creation platform that
              provides:
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {[
                {
                  title: 'Story Development',
                  desc: 'AI-assisted story generation, screenplay editing, and character/location management',
                },
                {
                  title: 'Visual Production',
                  desc: 'AI video generation using Kling, Hailuo, and Runway',
                },
                {
                  title: 'Audio Production',
                  desc: 'AI voice synthesis and music generation via ElevenLabs, PlayHT, Suno',
                },
                {
                  title: 'Publishing',
                  desc: 'Multi-platform publishing to YouTube, TikTok, Instagram, Facebook, Twitter, LinkedIn',
                },
                {
                  title: 'Analytics',
                  desc: 'Performance tracking across connected platforms',
                },
                {
                  title: 'Team Collaboration',
                  desc: 'Multi-user workspaces with role-based permissions',
                },
              ].map((item, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50"
                >
                  <h4 className="font-medium text-slate-900 dark:text-white">
                    {item.title}
                  </h4>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    {item.desc}
                  </p>
                </div>
              ))}
            </div>
          </Section>

          {/* Section 3 */}
          <Section
            id="section-3"
            icon={Users}
            title="3. Account Registration"
            color="blue"
          >
            <div className="space-y-4">
              <div>
                <h4 className="mb-2 font-medium text-slate-900 dark:text-white">
                  3.1 Eligibility
                </h4>
                <p>
                  You must be at least 18 years old or the age of legal majority
                  in your jurisdiction to use the Service. By creating an
                  account, you represent that you meet this requirement.
                </p>
              </div>
              <div>
                <h4 className="mb-2 font-medium text-slate-900 dark:text-white">
                  3.2 Account Security
                </h4>
                <p>
                  You are responsible for maintaining the confidentiality of
                  your account credentials and for all activities that occur
                  under your account. You agree to notify us immediately of any
                  unauthorized access or security breach.
                </p>
              </div>
              <div>
                <h4 className="mb-2 font-medium text-slate-900 dark:text-white">
                  3.3 Account Types
                </h4>
                <p>
                  We offer personal accounts and team accounts. Team account
                  owners are responsible for the actions of all team members
                  invited to their workspace.
                </p>
              </div>
            </div>
          </Section>

          {/* Section 4 */}
          <Section
            id="section-4"
            icon={FileText}
            title="4. User Content"
            color="teal"
          >
            <div className="space-y-4">
              <div>
                <h4 className="mb-2 font-medium text-slate-900 dark:text-white">
                  4.1 Your Content
                </h4>
                <p>
                  You retain all intellectual property rights to content you
                  create using the Service (&quot;User Content&quot;), including
                  stories, characters, screenplays, and generated media. By
                  using the Service, you grant us a limited license to process,
                  store, and display your content solely for the purpose of
                  providing the Service.
                </p>
              </div>
              <div>
                <h4 className="mb-2 font-medium text-slate-900 dark:text-white">
                  4.2 AI-Generated Content
                </h4>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
                  <p className="text-sm text-amber-800 dark:text-amber-200">
                    <strong>Important:</strong> AI-generated content may not be
                    unique. You are responsible for reviewing Generated Content
                    for accuracy and appropriateness before commercial use.
                  </p>
                </div>
              </div>
              <div>
                <h4 className="mb-2 font-medium text-slate-900 dark:text-white">
                  4.3 Prohibited Content
                </h4>
                <div className="grid gap-2 text-sm">
                  {[
                    'Illegal, harmful, threatening, abusive, or discriminatory content',
                    'Content that infringes intellectual property rights',
                    'Child sexual abuse material (CSAM) or content exploiting minors',
                    'Malware, viruses, or other harmful code',
                    'Content that impersonates any person or entity',
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <Ban className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
                      <span className="text-slate-600 dark:text-slate-400">
                        {item}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Section>

          {/* Section 5 */}
          <Section
            id="section-5"
            icon={Share2}
            title="5. Third-Party Platform Integrations"
            color="pink"
          >
            <div className="space-y-4">
              <p>
                The Service allows you to connect your accounts on third-party
                platforms (YouTube, TikTok, Instagram, Facebook, Twitter,
                LinkedIn). By connecting these accounts, you authorize us to
                access and interact with these platforms on your behalf.
              </p>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                <h4 className="mb-2 font-medium text-slate-900 dark:text-white">
                  Platform Terms
                </h4>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  When publishing content to third-party platforms, you must
                  comply with their respective terms of service. We are not
                  responsible for actions taken by third-party platforms.
                </p>
              </div>
            </div>
          </Section>

          {/* Section 6 */}
          <Section
            id="section-6"
            icon={CreditCard}
            title="6. Payment and Billing"
            color="emerald"
          >
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                  <h4 className="mb-2 font-medium text-slate-900 dark:text-white">
                    Subscription Plans
                  </h4>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Access to certain features requires a paid subscription. All
                    fees are quoted in USD.
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                  <h4 className="mb-2 font-medium text-slate-900 dark:text-white">
                    Payment Processing
                  </h4>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    We use Stripe and Lemon Squeezy for secure payment
                    processing.
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                  <h4 className="mb-2 font-medium text-slate-900 dark:text-white">
                    Cancellation
                  </h4>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Cancel anytime. Cancellation takes effect at the end of your
                    billing period.
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                  <h4 className="mb-2 font-medium text-slate-900 dark:text-white">
                    AI Credits
                  </h4>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Certain AI features consume credits. Unused credits may
                    expire per plan terms.
                  </p>
                </div>
              </div>
            </div>
          </Section>

          {/* Section 7 */}
          <Section
            id="section-7"
            icon={Shield}
            title="7. Intellectual Property"
            color="slate"
          >
            <p>
              The Service, including its original code, features, functionality,
              design, and branding, is owned by {companyName} and protected by
              intellectual property laws. You may not copy, modify, or create
              derivative works based on the Service.
            </p>
          </Section>

          {/* Section 8 */}
          <Section
            id="section-8"
            icon={AlertTriangle}
            title="8. Limitation of Liability"
            color="amber"
          >
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 dark:border-amber-800 dark:bg-amber-900/20">
              <p className="mb-4 text-sm font-medium tracking-wide text-amber-800 uppercase dark:text-amber-200">
                Important Legal Notice
              </p>
              <p className="text-sm text-amber-700 dark:text-amber-300">
                TO THE MAXIMUM EXTENT PERMITTED BY LAW,{' '}
                {companyName.toUpperCase()} SHALL NOT BE LIABLE FOR ANY
                INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE
                DAMAGES. OUR TOTAL LIABILITY SHALL NOT EXCEED THE AMOUNT PAID BY
                YOU DURING THE TWELVE (12) MONTHS PRECEDING THE CLAIM.
              </p>
            </div>
          </Section>

          {/* Section 9 */}
          <Section id="section-9" icon={Ban} title="9. Termination" color="red">
            <p className="mb-4">
              We may terminate or suspend your account immediately, without
              prior notice, for any reason, including breach of these Terms.
              Upon termination:
            </p>
            <ul className="space-y-2 text-slate-600 dark:text-slate-400">
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-red-500" />
                Your right to use the Service will immediately cease
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-red-500" />
                You may request export of your content within 30 days
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-red-500" />
                We may delete your data after a reasonable retention period
              </li>
            </ul>
          </Section>

          {/* Section 10 */}
          <Section
            id="section-10"
            icon={Globe}
            title="10. Governing Law"
            color="cyan"
          >
            <p>
              These Terms shall be governed by the laws of India, without regard
              to conflict of law principles. Any disputes shall be resolved in
              the courts of India.
            </p>
          </Section>

          {/* Contact Section */}
          <div className="rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-violet-50 p-8 text-center dark:border-indigo-800 dark:from-indigo-900/20 dark:to-violet-900/20">
            <Mail className="mx-auto mb-4 h-8 w-8 text-indigo-500" />
            <h3 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">
              Questions?
            </h3>
            <p className="mb-4 text-slate-600 dark:text-slate-400">
              If you have questions about these Terms, please contact us.
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
    indigo:
      'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400',
    violet:
      'bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400',
    blue: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
    teal: 'bg-teal-100 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400',
    pink: 'bg-pink-100 text-pink-600 dark:bg-pink-900/30 dark:text-pink-400',
    emerald:
      'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
    slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
    amber:
      'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
    red: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
    cyan: 'bg-cyan-100 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-400',
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

export default withI18n(TermsOfServicePage);
