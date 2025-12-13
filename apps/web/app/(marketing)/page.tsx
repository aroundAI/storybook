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
              <span>Deepseek V3 Integration Now Live</span>
              <PillActionButton asChild>
                <Link href={'/auth/sign-up'}>
                  <ArrowRightIcon className={'h-4 w-4'} />
                </Link>
              </PillActionButton>
            </Pill>
          }
          title={
            <>
              <span>The AI-Powered</span>
              <span>Production Bible</span>
            </>
          }
          subtitle={
            <span>
              From undefined concept to Season 1 Greenlight. StoryBook helps
              studios, writers, and producers manage characters, locations, and
              storylines with generative AI.
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
                  Your Virtual Writer's Room
                </b>
                .{' '}
                <span className="text-muted-foreground font-normal tracking-tighter">
                  Everything you need to showrun your next hit series. Centralize
                  your creative truth and let AI handle the heavy lifting.
                </span>
              </>
            }
            icon={
              <FeatureShowcaseIconContainer>
                <LayoutDashboard className="h-5" />
                <span>Production Ready</span>
              </FeatureShowcaseIconContainer>
            }
          >
            <FeatureGrid>
              <FeatureCard
                className={'relative col-span-1 overflow-hidden'}
                label={'Season Generation'}
                description={`Turn loose roadmaps or paragraphs into structured episode guides with one click. Automatically extracts characters and locations.`}
              ></FeatureCard>

              <FeatureCard
                className={'relative col-span-1 w-full overflow-hidden'}
                label={'Asset Bible'}
                description={`Centralized character and location management. Track relationships, voice profiles, and settings with RAG-powered consistency.`}
              ></FeatureCard>

              <FeatureCard
                className={'relative col-span-1 overflow-hidden'}
                label={'Story Ideation'}
                description={`Deepseek-powered premise development and plot structuring. Refine loglines, beats, and scenes collaboratively.`}
              />

              <FeatureCard
                className={'relative col-span-1 overflow-hidden md:col-span-2'}
                label={'Studio Workflow'}
                description={`built for teams. Assign Showrunners, Writers, and Producers with granular permissions. Manage multiple Shows in one workspace.`}
              />

              <FeatureCard
                className={'relative col-span-1 overflow-hidden'}
                label={'Screenplay Editor'}
                description={`Collaborative script editor with AI co-pilot. Auto-format to standard industry screenplay format.`}
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
            heading="Flexible pricing for Indie Creators & Studios"
            subheading="Start with a free Pilot project and upgrade when you get Greenlit."
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
