import { Progress } from '@kit/ui/progress';

export function Default() {
  return (
    <div className="w-[360px] space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">Generating shot list…</span>
        <span className="text-muted-foreground">64%</span>
      </div>
      <Progress value={64} />
    </div>
  );
}

export function Stages() {
  return (
    <div className="w-[360px] space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span>Ideation</span>
          <span className="text-muted-foreground">Complete</span>
        </div>
        <Progress value={100} />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span>Story</span>
          <span className="text-muted-foreground">Complete</span>
        </div>
        <Progress value={100} />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span>Screenplay</span>
          <span className="text-muted-foreground">42%</span>
        </div>
        <Progress value={42} />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Shots</span>
          <span className="text-muted-foreground">Queued</span>
        </div>
        <Progress value={0} />
      </div>
    </div>
  );
}
