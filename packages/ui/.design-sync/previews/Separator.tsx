import { Separator } from '@kit/ui/separator';

export function Default() {
  return (
    <div className="w-[360px] space-y-1">
      <h4 className="text-sm font-semibold">Audio Generation Settings</h4>
      <p className="text-muted-foreground text-xs">
        Configure the voice and SFX providers for this project.
      </p>
      <Separator className="my-4" />
      <p className="text-muted-foreground text-xs">
        Changes apply to all future episode renders.
      </p>
    </div>
  );
}

export function Vertical() {
  return (
    <div className="flex h-8 items-center gap-3 text-sm">
      <span>Canon Health</span>
      <Separator orientation="vertical" />
      <span className="text-muted-foreground">3 Warnings</span>
      <Separator orientation="vertical" />
      <span className="text-muted-foreground">Ep 6</span>
    </div>
  );
}
