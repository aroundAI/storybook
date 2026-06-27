import { LoadingOverlay } from '@kit/ui/loading-overlay';

export function Default() {
  return (
    <div className="relative h-48 overflow-hidden rounded-lg border">
      <LoadingOverlay fullPage={false} />
    </div>
  );
}

export function WithMessage() {
  return (
    <div className="relative h-48 overflow-hidden rounded-lg border">
      <LoadingOverlay fullPage={false}>
        Rendering Scene 3 shots with VEO 3.1...
      </LoadingOverlay>
    </div>
  );
}
