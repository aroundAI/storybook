import { Metadata } from 'next';

import Link from 'next/link';

import {
  ArrowRightIcon,
  BookOpen,
  ChevronRight,
  Film,
  LayoutDashboard,
  Palette,
  Sparkles,
  Users,
} from 'lucide-react';

import { Button } from '@kit/ui/button';
import {
  CtaButton,
  FeatureCard,
  FeatureGrid,
  FeatureShowcase,
  FeatureShowcaseIconContainer,
  Pill,
  SecondaryHero,
} from '@kit/ui/marketing';
import { Trans } from '@kit/ui/trans';

import appConfig from '~/config/app.config';
import { withI18n } from '~/lib/i18n/with-i18n';
import { JsonLd, getSoftwareApplicationSchema } from '~/lib/structured-data';

import { RotatingText } from './_components/rotating-text';

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: `${appConfig.name} - AI-Powered Film Studio for Content Creators`,
    description:
      'Create professional video content with AI. Generate stories, screenplays, visuals, and audio. Publish to YouTube, TikTok, Instagram, and more.',
    keywords: [
      'AI video generation',
      'content creation',
      'film production',
      'screenplay writing',
      'video editing',
      'AI storytelling',
      'YouTube automation',
      'TikTok content',
      'social media publishing',
    ],
    authors: [{ name: 'StoryBook Team' }],
    alternates: {
      canonical: appConfig.url,
    },
    openGraph: {
      title: `${appConfig.name} - AI-Powered Film Studio`,
      description:
        'Create professional video content with AI. Generate stories, screenplays, visuals, and audio.',
      url: appConfig.url,
      siteName: appConfig.name,
      type: 'website',
      locale: appConfig.locale,
    },
    twitter: {
      card: 'summary_large_image',
      title: `${appConfig.name} - AI-Powered Film Studio`,
      description:
        'Create professional video content with AI. Generate stories, screenplays, visuals, and audio.',
    },
  };
}

function Home() {
  const softwareSchema = getSoftwareApplicationSchema();

  return (
    <div className={'flex flex-col'}>
      {/* SEO: Product structured data */}
      <JsonLd data={softwareSchema} />

      {/* Hero Section with Gradient Background */}

      <section className="relative overflow-hidden bg-gradient-to-b from-slate-50 via-white to-slate-50/50 py-12 lg:py-16 dark:from-slate-950 dark:via-slate-900 dark:to-black">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
            <div className="relative z-10 space-y-6">
              <Pill label={'New'} className="w-fit">
                <span className="bg-gradient-to-r from-blue-500 to-indigo-500 bg-clip-text font-semibold text-transparent">
                  Deepseek V3 Integration Now Live
                </span>
              </Pill>

              <h1 className="max-w-2xl text-4xl leading-tight font-bold lg:text-5xl">
                The AI-Powered{' '}
                <RotatingText
                  texts={['Production Bible', "Writer's Room", 'Story Engine']}
                  className="bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 bg-clip-text text-transparent"
                />
              </h1>

              <p className="text-muted-foreground max-w-2xl text-lg leading-relaxed">
                From undefined concept to Season 1 Greenlight. StoryBook helps
                studios, writers, and producers manage characters, locations,
                and storylines with generative AI.
              </p>

              <div className="flex flex-col gap-4 pt-2 sm:flex-row">
                <Button
                  asChild
                  size="lg"
                  className="bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600"
                >
                  <Link href="/auth/sign-up">
                    <Trans i18nKey={'common:getStarted'} />
                    <ChevronRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link href="/contact">
                    <Trans i18nKey={'common:contactUs'} />
                  </Link>
                </Button>
              </div>
            </div>

            {/* Hero Visual - Modern Glass Cards */}
            <div className="relative hidden lg:block">
              <div className="relative grid grid-cols-2 gap-3">
                {/* Glass card 1 */}
                <div className="group relative overflow-hidden rounded-2xl border border-slate-200/50 bg-white/80 p-5 shadow-sm backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-slate-300/50 hover:shadow-md dark:border-white/[0.08] dark:bg-white/[0.03] dark:backdrop-blur-md dark:hover:border-white/[0.12] dark:hover:bg-white/[0.05] dark:hover:shadow-lg">
                  <div className="animate-glow absolute -top-8 -right-8 h-24 w-24 rounded-full bg-gradient-to-br from-slate-400 to-slate-300 blur-2xl dark:from-slate-400 dark:to-slate-300" />
                  <div className="relative flex h-[120px] flex-col justify-between">
                    <div>
                      <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100/70 dark:bg-slate-500/10 dark:ring-1 dark:ring-white/5">
                        <Film className="h-4 w-4 text-slate-700 dark:text-slate-300" />
                      </div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                        Visual Studio
                      </h3>
                    </div>
                    <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                      AI-powered shot lists with VEO 3.1 prompts
                    </p>
                  </div>
                </div>

                {/* Glass card 2 */}
                <div className="group relative overflow-hidden rounded-2xl border border-slate-200/50 bg-white/80 p-5 shadow-sm backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-slate-300/50 hover:shadow-md dark:border-white/[0.08] dark:bg-white/[0.03] dark:backdrop-blur-md dark:hover:border-white/[0.12] dark:hover:bg-white/[0.05] dark:hover:shadow-lg">
                  <div
                    className="animate-glow absolute -top-8 -right-8 h-24 w-24 rounded-full bg-gradient-to-br from-indigo-400 to-blue-300 blur-2xl dark:from-indigo-400 dark:to-blue-400"
                    style={{ animationDelay: '0.5s' }}
                  />
                  <div className="relative flex h-[120px] flex-col justify-between">
                    <div>
                      <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100/70 dark:bg-indigo-500/10 dark:ring-1 dark:ring-white/5">
                        <Users className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                      </div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                        Character Bible
                      </h3>
                    </div>
                    <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                      Manage characters with AI consistency
                    </p>
                  </div>
                </div>

                {/* Glass card 3 */}
                <div className="group relative overflow-hidden rounded-2xl border border-slate-200/50 bg-white/80 p-5 shadow-sm backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-slate-300/50 hover:shadow-md dark:border-white/[0.08] dark:bg-white/[0.03] dark:backdrop-blur-md dark:hover:border-white/[0.12] dark:hover:bg-white/[0.05] dark:hover:shadow-lg">
                  <div
                    className="animate-glow absolute -bottom-8 -left-8 h-24 w-24 rounded-full bg-gradient-to-br from-violet-400 to-purple-300 blur-2xl dark:from-violet-400 dark:to-purple-400"
                    style={{ animationDelay: '1s' }}
                  />
                  <div className="relative flex h-[120px] flex-col justify-between">
                    <div>
                      <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-violet-100/70 dark:bg-violet-500/10 dark:ring-1 dark:ring-white/5">
                        <BookOpen className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                      </div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                        Screenplay Editor
                      </h3>
                    </div>
                    <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                      Industry-standard format with AI co-pilot
                    </p>
                  </div>
                </div>

                {/* Glass card 4 */}
                <div className="group relative overflow-hidden rounded-2xl border border-slate-200/50 bg-white/80 p-5 shadow-sm backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-slate-300/50 hover:shadow-md dark:border-white/[0.08] dark:bg-white/[0.03] dark:backdrop-blur-md dark:hover:border-white/[0.12] dark:hover:bg-white/[0.05] dark:hover:shadow-lg">
                  <div
                    className="animate-glow absolute -right-8 -bottom-8 h-24 w-24 rounded-full bg-gradient-to-br from-teal-400 to-emerald-300 blur-2xl dark:from-teal-400 dark:to-emerald-400"
                    style={{ animationDelay: '1.5s' }}
                  />
                  <div className="relative flex h-[120px] flex-col justify-between">
                    <div>
                      <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100/70 dark:bg-teal-500/10 dark:ring-1 dark:ring-white/5">
                        <Sparkles className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                      </div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                        Audio Studio
                      </h3>
                    </div>
                    <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                      AI voice generation and music
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="relative overflow-hidden bg-gradient-to-b from-white via-slate-50/30 to-white py-12 lg:py-16 dark:from-black dark:via-slate-950/50 dark:to-black">
        <div className={'container mx-auto px-4'}>
          <FeatureShowcase
            heading={
              <>
                <b className="font-medium tracking-tighter dark:text-white">
                  Your Virtual Writer&apos;s Room
                </b>
                .{' '}
                <span className="text-muted-foreground font-normal tracking-tighter">
                  Everything you need to showrun your next hit series.
                  Centralize your creative truth and let AI handle the heavy
                  lifting.
                </span>
              </>
            }
            icon={
              <FeatureShowcaseIconContainer className="bg-gradient-to-r from-slate-500/10 to-indigo-500/10">
                <LayoutDashboard className="h-5 text-indigo-600" />
                <span>Production Ready</span>
              </FeatureShowcaseIconContainer>
            }
          >
            <FeatureGrid>
              <FeatureCard
                className={
                  'group relative col-span-1 overflow-hidden border-slate-200/50 bg-white/80 backdrop-blur-sm hover:border-slate-300/50 dark:border-white/[0.08] dark:bg-white/[0.03] dark:backdrop-blur-md dark:hover:border-white/[0.12]'
                }
                label={'Season Generation'}
                description={`Turn loose roadmaps or paragraphs into structured episode guides with one click. Automatically extracts characters and locations.`}
              >
                <div
                  className="animate-glow absolute -top-12 -right-12 h-32 w-32 rounded-full bg-gradient-to-br from-slate-400 to-slate-300 blur-3xl dark:from-slate-400 dark:to-slate-300"
                  style={{ animationDelay: '0.2s' }}
                />
              </FeatureCard>

              <FeatureCard
                className={
                  'group relative col-span-1 w-full overflow-hidden border-indigo-200/50 bg-white/80 backdrop-blur-sm hover:border-indigo-300/50 dark:border-white/[0.08] dark:bg-white/[0.03] dark:backdrop-blur-md dark:hover:border-white/[0.12]'
                }
                label={'Asset Bible'}
                description={`Centralized character and location management. Track relationships, voice profiles, and settings with RAG-powered consistency.`}
              >
                <div
                  className="animate-glow absolute -bottom-12 -left-12 h-32 w-32 rounded-full bg-gradient-to-br from-indigo-400 to-blue-300 blur-3xl dark:from-indigo-400 dark:to-blue-400"
                  style={{ animationDelay: '0.7s' }}
                />
              </FeatureCard>

              <FeatureCard
                className={
                  'group relative col-span-1 overflow-hidden border-violet-200/50 bg-white/80 backdrop-blur-sm hover:border-violet-300/50 dark:border-white/[0.08] dark:bg-white/[0.03] dark:backdrop-blur-md dark:hover:border-white/[0.12]'
                }
                label={'Story Ideation'}
                description={`Deepseek-powered premise development and plot structuring. Refine loglines, beats, and scenes collaboratively.`}
              >
                <div
                  className="animate-glow absolute -right-12 -bottom-12 h-32 w-32 rounded-full bg-gradient-to-br from-violet-400 to-purple-300 blur-3xl dark:from-violet-400 dark:to-purple-400"
                  style={{ animationDelay: '1.2s' }}
                />
              </FeatureCard>

              <FeatureCard
                className={
                  'group relative col-span-1 overflow-hidden border-teal-200/50 bg-white/80 backdrop-blur-sm hover:border-teal-300/50 md:col-span-2 dark:border-white/[0.08] dark:bg-white/[0.03] dark:backdrop-blur-md dark:hover:border-white/[0.12]'
                }
                label={'Studio Workflow'}
                description={`Built for teams. Assign Showrunners, Writers, and Producers with granular permissions. Manage multiple Shows in one workspace.`}
              >
                <div
                  className="animate-glow absolute -top-12 -right-20 h-40 w-40 rounded-full bg-gradient-to-br from-teal-400 to-emerald-300 blur-3xl dark:from-teal-400 dark:to-emerald-400"
                  style={{ animationDelay: '1.7s' }}
                />
              </FeatureCard>

              <FeatureCard
                className={
                  'group relative col-span-1 overflow-hidden border-slate-200/50 bg-white/80 backdrop-blur-sm hover:border-slate-300/50 dark:border-white/[0.08] dark:bg-white/[0.03] dark:backdrop-blur-md dark:hover:border-white/[0.12]'
                }
                label={'Screenplay Editor'}
                description={`Collaborative script editor with AI co-pilot. Auto-format to standard industry screenplay format.`}
              >
                <div
                  className="animate-glow absolute -top-12 -left-12 h-32 w-32 rounded-full bg-gradient-to-br from-indigo-400 to-violet-300 blur-3xl dark:from-indigo-400 dark:to-violet-400"
                  style={{ animationDelay: '2.2s' }}
                />
              </FeatureCard>
            </FeatureGrid>
          </FeatureShowcase>
        </div>
      </section>

      {/* Why Choose Section */}
      <section className="relative overflow-hidden bg-gradient-to-b from-slate-50/50 via-white to-slate-50 py-12 lg:py-16 dark:from-black dark:via-slate-900 dark:to-slate-950">
        <div className={'container mx-auto px-4'}>
          <div
            className={'flex flex-col items-center justify-center space-y-16'}
          >
            <SecondaryHero
              pill={
                <Pill label="Built for Creators">From Concept to Screen</Pill>
              }
              heading="Why Choose StoryBook"
              subheading="The complete AI toolkit for modern showrunners and content creators."
            />

            <div className={'max-w-4xl space-y-4 text-center'}>
              <p className="text-muted-foreground text-lg">
                StoryBook brings the power of generative AI to every stage of
                production. From ideation to final cut, we help you maintain
                consistency and accelerate your creative workflow.
              </p>

              <div className="grid grid-cols-1 gap-8 pt-12 md:grid-cols-2">
                <div className="group relative rounded-2xl border border-slate-200/50 bg-white/80 p-6 text-left backdrop-blur-sm hover:border-slate-300/50 dark:border-white/[0.08] dark:bg-white/[0.03] dark:backdrop-blur-md dark:hover:border-white/[0.12]">
                  <div
                    className="animate-glow absolute -top-16 -left-16 h-32 w-32 rounded-full bg-gradient-to-br from-indigo-400 to-blue-300 blur-3xl dark:from-indigo-400 dark:to-blue-400"
                    style={{ animationDelay: '0.3s' }}
                  />
                  <h3 className="relative z-10 mb-3 text-xl font-semibold">
                    For Writers
                  </h3>
                  <ul className="text-muted-foreground relative z-10 space-y-3">
                    <li className="flex items-start">
                      <Palette className="mt-0.5 mr-3 h-4 w-4 text-indigo-600" />
                      <span>AI-assisted story development</span>
                    </li>
                    <li className="flex items-start">
                      <Palette className="mt-0.5 mr-3 h-4 w-4 text-indigo-600" />
                      <span>Character consistency across episodes</span>
                    </li>
                    <li className="flex items-start">
                      <Palette className="mt-0.5 mr-3 h-4 w-4 text-indigo-600" />
                      <span>Industry-standard screenplay format</span>
                    </li>
                  </ul>
                </div>

                <div className="group relative rounded-2xl border border-slate-200/50 bg-white/80 p-6 text-left backdrop-blur-sm hover:border-slate-300/50 dark:border-white/[0.08] dark:bg-white/[0.03] dark:backdrop-blur-md dark:hover:border-white/[0.12]">
                  <div
                    className="animate-glow absolute -right-16 -bottom-16 h-32 w-32 rounded-full bg-gradient-to-br from-violet-400 to-purple-300 blur-3xl dark:from-violet-400 dark:to-purple-400"
                    style={{ animationDelay: '0.8s' }}
                  />
                  <h3 className="relative z-10 mb-3 text-xl font-semibold">
                    For Producers
                  </h3>
                  <ul className="text-muted-foreground relative z-10 space-y-3">
                    <li className="flex items-start">
                      <Palette className="mt-0.5 mr-3 h-4 w-4 text-violet-600" />
                      <span>Visual shot lists for production</span>
                    </li>
                    <li className="flex items-start">
                      <Palette className="mt-0.5 mr-3 h-4 w-4 text-violet-600" />
                      <span>Team collaboration with permissions</span>
                    </li>
                    <li className="flex items-start">
                      <Palette className="mt-0.5 mr-3 h-4 w-4 text-violet-600" />
                      <span>Multi-platform publishing workflow</span>
                    </li>
                  </ul>
                </div>
              </div>

              <div className="pt-12">
                <MainCallToActionButton />
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default withI18n(Home);

function MainCallToActionButton() {
  return (
    <div className={'flex justify-center space-x-4'}>
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
