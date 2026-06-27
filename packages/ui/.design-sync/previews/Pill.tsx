import { Pill, PillActionButton } from '@kit/ui/marketing';

export function Default() {
  return (
    <Pill label="New">
      <span className="bg-gradient-to-r from-blue-500 to-indigo-500 bg-clip-text font-semibold text-transparent">
        Deepseek V3 Integration Now Live
      </span>
    </Pill>
  );
}

export function WithoutLabel() {
  return <Pill>Built for Creators &mdash; From Concept to Screen</Pill>;
}

export function WithActionButton() {
  return (
    <Pill label="Beta" className="pr-1">
      <span className="flex items-center gap-x-2">
        VEO 3.1 shot prompts
        <PillActionButton aria-label="Dismiss">&times;</PillActionButton>
      </span>
    </Pill>
  );
}
