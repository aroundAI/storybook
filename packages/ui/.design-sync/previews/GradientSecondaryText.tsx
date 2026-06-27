import { GradientSecondaryText } from '@kit/ui/marketing';

export function Default() {
  return (
    <GradientSecondaryText className="text-lg font-medium">
      Deepseek V3 Integration Now Live
    </GradientSecondaryText>
  );
}

export function AsParagraph() {
  return (
    <p className="max-w-sm text-center">
      <GradientSecondaryText className="text-xl">
        From undefined concept to Season 1 greenlight.
      </GradientSecondaryText>
    </p>
  );
}
