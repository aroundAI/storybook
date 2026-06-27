import { Spinner } from '@kit/ui/spinner';

export function Default() {
  return <Spinner />;
}

export function WithLabel() {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Spinner className="h-4 w-4" />
      <span>Generating shot list…</span>
    </div>
  );
}
