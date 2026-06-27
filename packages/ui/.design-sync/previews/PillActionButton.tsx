import { Pill, PillActionButton } from '@kit/ui/marketing';

export function Default() {
  return (
    <Pill label="Beta" className="pr-1">
      <span className="flex items-center gap-x-2">
        VEO 3.1 shot prompts
        <PillActionButton aria-label="Dismiss">&times;</PillActionButton>
      </span>
    </Pill>
  );
}
