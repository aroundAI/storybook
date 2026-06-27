import { MobileModeToggle } from '@kit/ui/mobile-mode-toggle';

export function Default() {
  return (
    <div className="flex w-full items-center justify-between border-b px-4 py-2">
      <span className="text-sm font-medium">Storybook</span>
      <MobileModeToggle />
    </div>
  );
}
