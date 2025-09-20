import Image from 'next/image';
import Link from 'next/link';

import { ArrowRightIcon, LayoutDashboard } from 'lucide-react';

import { PricingTable } from '@kit/billing-gateway/marketing';
import {
  CtaButton,
  FeatureCard,
  FeatureGrid,
  FeatureShowcase,
  FeatureShowcaseIconContainer,
  Hero,
  Pill,
  PillActionButton,
  SecondaryHero,
} from '@kit/ui/marketing';
import { Trans } from '@kit/ui/trans';

import billingConfig from '~/config/billing.config';
import pathsConfig from '~/config/paths.config';
import { withI18n } from '~/lib/i18n/with-i18n';

function Home() {
  return (
    <div className={'mt-4 flex flex-col space-y-24 py-14'}>
      <div className={'container mx-auto'}>
        <Hero
          pill={
            <Pill label={'New'}>
              <span>The SaaS Starter Kit for ambitious developers</span>
              <PillActionButton asChild>
                <Link href={'/auth/sign-up'}>
                  <ArrowRightIcon className={'h-4 w-4'} />
                </Link>
              </PillActionButton>
            </Pill>
          }
          title={
            <>
              <span>The ultimate SaaS Starter</span>
              <span>for your next project</span>
            </>
          }
          subtitle={
            <span>
              Build and Ship a SaaS faster than ever before with the next-gen
              SaaS Starter Kit. Ship your SaaS in days, not months.
            </span>
          }
          cta={<MainCallToActionButton />}
          image={
            <Image
              priority
              className={
                'dark:border-primary/10 rounded-xl border border-gray-200'
              }
              width={3558}
              height={2222}
              src={`/images/dashboard.webp`}
              alt={`App Image`}
            />
          }
        />
      </div>

      <div className={'container mx-auto'}>
        <div
          className={'flex flex-col space-y-16 xl:space-y-32 2xl:space-y-36'}
        >
          <FeatureShowcase
            heading={
              <>
                <b className="font-medium tracking-tighter dark:text-white">
                  The ultimate SaaS Starter Kit
                </b>
                .{' '}
                <span className="text-muted-foreground font-normal tracking-tighter">
                  Unleash your creativity and build your SaaS faster than ever
                  with Makerkit.
                </span>
              </>
            }
            icon={
              <FeatureShowcaseIconContainer>
                <LayoutDashboard className="h-5" />
                <span>All-in-one solution</span>
              </FeatureShowcaseIconContainer>
            }
          >
            <FeatureGrid>
              <FeatureCard
                className={'relative col-span-1 overflow-hidden'}
                label={'Beautiful Dashboard'}
                description={`Makerkit provides a beautiful dashboard to manage your SaaS business.`}
              ></FeatureCard>

              <FeatureCard
                className={'relative col-span-1 w-full overflow-hidden'}
                label={'Authentication'}
                description={`Makerkit provides a variety of providers to allow your users to sign in.`}
              ></FeatureCard>

              <FeatureCard
                className={'relative col-span-1 overflow-hidden'}
                label={'Multi Tenancy'}
                description={`Multi tenant memberships for your SaaS business.`}
              />

              <FeatureCard
                className={'relative col-span-1 overflow-hidden md:col-span-2'}
                label={'Billing'}
                description={`Makerkit supports multiple payment gateways to charge your customers.`}
              />

              <FeatureCard
                className={'relative col-span-1 overflow-hidden'}
                label={'Plugins'}
                description={`Extend your SaaS with plugins that you can install using the CLI.`}
              />
            </FeatureGrid>
          </FeatureShowcase>
        </div>
      </div>

      <div className={'container mx-auto'}>
        <div
          className={
            'flex flex-col items-center justify-center space-y-16 py-16'
          }
        >
          <SecondaryHero
            pill={<Pill label="Start for free">No credit card required.</Pill>}
            heading="Fair pricing for all types of businesses"
            subheading="Get started on our free plan and upgrade when you are ready."
          />

          <div className={'w-full'}>
            <PricingTable
              config={billingConfig}
              paths={{
                signUp: pathsConfig.auth.signUp,
                return: pathsConfig.app.home,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default withI18n(Home);

function MainCallToActionButton() {
  return (
    <div className={'flex space-x-4'}>
      <CtaButton>
        <Link href={'/auth/sign-up'}>
          <span className={'flex items-center space-x-0.5'}>
            <span>
              <Trans i18nKey={'common:getStarted'} />
            </span>

            <ArrowRightIcon
              className={
                'animate-in fade-in slide-in-from-left-8 h-4' +
                ' zoom-in fill-mode-both delay-1000 duration-1000'
              }
            />
          </span>
        </Link>
      </CtaButton>

      <CtaButton variant={'link'}>
        <Link href={'/contact'}>
          <Trans i18nKey={'common:contactUs'} />
        </Link>
      </CtaButton>
    </div>
  );
}
