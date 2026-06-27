import { ModeToggle } from '@kit/ui/mode-toggle';

export function Default() {
  return (
    <div className="flex w-full items-center justify-between rounded-md border px-4 py-3">
      <span className="text-sm font-medium">Appearance</span>
      <ModeToggle />
    </div>
  );
}
