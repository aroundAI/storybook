import { Pill, SecondaryHero } from '@kit/ui/marketing';

export function Default() {
  return (
    <div className="max-w-2xl">
      <SecondaryHero
        pill={<Pill label="Built for Creators">From Concept to Screen</Pill>}
        heading="Why Choose StoryBook"
        subheading="The complete AI toolkit for modern showrunners and content creators."
      />
    </div>
  );
}
