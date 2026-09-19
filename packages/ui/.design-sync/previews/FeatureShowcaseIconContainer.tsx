import { LayoutDashboard } from 'lucide-react';

import {
  FeatureCard,
  FeatureGrid,
  FeatureShowcase,
  FeatureShowcaseIconContainer,
} from '@kit/ui/marketing';

export function Default() {
  return (
    <div className="max-w-3xl">
      <FeatureShowcase
        heading={
          <>
            <b className="font-medium tracking-tighter">
              Your Virtual Writer&apos;s Room
            </b>
            .{' '}
            <span className="font-normal tracking-tighter text-muted-foreground">
              Everything you need to showrun your next hit series.
            </span>
          </>
        }
        icon={
          <FeatureShowcaseIconContainer className="bg-gradient-to-r from-slate-500/10 to-indigo-500/10">
            <LayoutDashboard className="h-5 text-indigo-400" />
            <span>Production Ready</span>
          </FeatureShowcaseIconContainer>
        }
      >
        <FeatureGrid>
          <FeatureCard
            label="Season Generation"
            description="Turn loose roadmaps into structured episode guides with one click."
          />
          <FeatureCard
            label="Asset Bible"
            description="Centralized character and location management with RAG-powered consistency."
          />
          <FeatureCard
            label="Story Ideation"
            description="Deepseek-powered premise development and plot structuring."
          />
        </FeatureGrid>
      </FeatureShowcase>
    </div>
  );
}
