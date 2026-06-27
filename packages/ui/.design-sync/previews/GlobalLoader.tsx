import { GlobalLoader } from '@kit/ui/global-loader';

export function Default() {
  return (
    <div className="relative h-48 overflow-hidden rounded-lg border">
      <GlobalLoader />
    </div>
  );
}

export function WithMessage() {
  return (
    <div className="relative h-48 overflow-hidden rounded-lg border">
      <GlobalLoader displayTopLoadingBar={false}>
        <p className="text-muted-foreground mt-4 text-sm">
          Generating shot list for Scene 4...
        </p>
      </GlobalLoader>
    </div>
  );
}
