import Link from 'next/link';

import { Twitter, Youtube } from 'lucide-react';

import { Footer } from '@kit/ui/marketing';
import { Trans } from '@kit/ui/trans';

import { AppLogo } from '~/components/app-logo';
import appConfig from '~/config/app.config';

export function SiteFooter() {
  return (
    <>
      {/* Newsletter Section with Glass Card */}
      <div className="relative overflow-hidden border-t border-slate-200/50 bg-gradient-to-b from-slate-50/80 via-white to-slate-50/50 py-8 dark:border-white/[0.08] dark:from-slate-950 dark:via-slate-900 dark:to-black">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-xl">
            <div className="group relative overflow-hidden rounded-xl border border-slate-200/50 bg-white/80 p-6 backdrop-blur-sm dark:border-white/[0.08] dark:bg-white/[0.03] dark:backdrop-blur-md">
              {/* Animated gradient orbs */}
              <div
                className="animate-glow absolute -top-16 -left-16 h-32 w-32 rounded-full bg-gradient-to-br from-violet-400/20 to-purple-300/20 blur-3xl dark:from-violet-400/10 dark:to-purple-400/10"
                style={{ animationDelay: '0s' }}
              />
              <div
                className="animate-glow absolute -right-16 -bottom-16 h-36 w-36 rounded-full bg-gradient-to-br from-indigo-400/20 to-blue-300/20 blur-3xl dark:from-indigo-400/10 dark:to-blue-400/10"
                style={{ animationDelay: '1.5s' }}
              />

              <div className="relative z-10 text-center">
                <h3 className="mb-2 bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 bg-clip-text text-xl font-bold text-transparent dark:from-violet-400 dark:via-purple-400 dark:to-indigo-400">
                  Stay Updated with StoryBook
                </h3>
                <p className="mb-5 text-sm text-slate-600 dark:text-slate-400">
                  Get the latest updates on AI video creation, new features, and
                  production tips.
                </p>
                <Link
                  href="/contact"
                  className="inline-flex items-center rounded-lg bg-gradient-to-r from-blue-500 to-indigo-500 px-6 py-2.5 text-sm font-medium text-white transition-all hover:from-blue-600 hover:to-indigo-600"
                >
                  Get in Touch
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
      <Footer
        logo={<AppLogo className="w-[85px] md:w-[95px]" />}
        description={<Trans i18nKey="marketing:footerDescription" />}
        copyright={
          <Trans
            i18nKey="marketing:copyright"
            values={{
              product: appConfig.name,
              year: new Date().getFullYear(),
            }}
          />
        }
        sections={[
          {
            heading: <Trans i18nKey="marketing:about" />,
            links: [
              { href: '/blog', label: <Trans i18nKey="marketing:blog" /> },
              { href: '/contact', label: <Trans i18nKey="marketing:contact" /> },
            ],
          },
          {
            heading: <Trans i18nKey="marketing:product" />,
            links: [
              {
                href: '/docs',
                label: <Trans i18nKey="marketing:documentation" />,
              },
              { href: '/pricing', label: 'Pricing' },
              { href: '/faq', label: 'FAQ' },
            ],
          },
          {
            heading: <Trans i18nKey="marketing:legal" />,
            links: [
              {
                href: '/terms-of-service',
                label: <Trans i18nKey="marketing:termsOfService" />,
              },
              {
                href: '/privacy-policy',
                label: <Trans i18nKey="marketing:privacyPolicy" />,
              },
              {
                href: '/cookie-policy',
                label: <Trans i18nKey="marketing:cookiePolicy" />,
              },
            ],
          },
        ]}
      >
        <div className="mt-6 flex gap-4">
          <Link
            href="https://youtube.com/@storybook"
            target="_blank"
            rel="noopener noreferrer"
            className="group text-muted-foreground relative transition-all hover:text-red-600 dark:hover:text-red-400"
            aria-label="Subscribe to our YouTube channel"
          >
            <Youtube className="h-5 w-5 transition-transform group-hover:scale-110" />
            <div className="absolute -inset-2 rounded-full bg-red-600/20 opacity-0 blur-lg transition-opacity group-hover:opacity-100" />
          </Link>
          <Link
            href="https://x.com/storybook"
            target="_blank"
            rel="noopener noreferrer"
            className="group text-muted-foreground relative transition-all hover:text-sky-600 dark:hover:text-sky-400"
            aria-label="Follow us on X (Twitter)"
          >
            <Twitter className="h-5 w-5 transition-transform group-hover:scale-110" />
            <div className="absolute -inset-2 rounded-full bg-sky-600/20 opacity-0 blur-lg transition-opacity group-hover:opacity-100" />
          </Link>
        </div>
      </Footer>
    </>
  );
}
