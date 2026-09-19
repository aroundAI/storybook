import { Label } from '@kit/ui/label';
import { Slider } from '@kit/ui/slider';

export function Default() {
  return (
    <div className="w-full max-w-sm space-y-2">
      <Label>Creativity</Label>
      <Slider min={1} max={5} step={1} defaultValue={[3]} />
    </div>
  );
}

export function CanonStrictness() {
  return (
    <div className="w-full max-w-sm space-y-2">
      <div className="flex items-center justify-between">
        <Label>Canon strictness</Label>
        <span className="text-sm text-muted-foreground tabular-nums">
          4 / 5
        </span>
      </div>
      <Slider min={1} max={5} step={1} defaultValue={[4]} />
      <p className="text-xs text-muted-foreground">
        Higher values reject screenplay drafts that contradict established
        character facts.
      </p>
    </div>
  );
}
