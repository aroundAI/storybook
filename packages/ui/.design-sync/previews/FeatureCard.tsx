import { FeatureCard, FeatureGrid } from '@kit/ui/marketing';

export function Default() {
  return (
    <div className="max-w-sm">
      <FeatureCard
        label="Season Generation"
        description="Turn loose roadmaps or paragraphs into structured episode guides with one click. Automatically extracts characters and locations."
      />
    </div>
  );
}

export function InGrid() {
  return (
    <div className="max-w-3xl">
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
    </div>
  );
}
