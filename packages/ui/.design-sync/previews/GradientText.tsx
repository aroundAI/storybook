import { GradientText } from '@kit/ui/marketing';

export function Default() {
  return (
    <h2 className="text-4xl font-semibold tracking-tight">
      The AI-Powered{' '}
      <GradientText className="bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500">
        Story Engine
      </GradientText>
    </h2>
  );
}

export function InParagraph() {
  return (
    <p className="max-w-md text-lg text-muted-foreground">
      Generate{' '}
      <GradientText className="bg-gradient-to-r from-violet-500 to-purple-500 font-semibold">
        screenplays, shot lists, and voiceovers
      </GradientText>{' '}
      from a single logline.
    </p>
  );
}
