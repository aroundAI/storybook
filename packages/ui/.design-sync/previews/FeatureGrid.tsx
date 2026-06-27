import { FeatureCard, FeatureGrid } from '@kit/ui/marketing';

export function Default() {
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
        <FeatureCard
          label="Studio Workflow"
          description="Assign Showrunners, Writers, and Producers with granular permissions."
        />
        <FeatureCard
          label="Screenplay Editor"
          description="Collaborative script editor with AI co-pilot and industry formatting."
        />
      </FeatureGrid>
    </div>
  );
}
