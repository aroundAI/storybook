import { HeroTitle } from '@kit/ui/marketing';

export function Default() {
  return (
    <HeroTitle>
      The AI-Powered <br />
      Story Engine
    </HeroTitle>
  );
}

export function ShortTitle() {
  return <HeroTitle className="text-5xl">Your Virtual Writer&apos;s Room</HeroTitle>;
}
