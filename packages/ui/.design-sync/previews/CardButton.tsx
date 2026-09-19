import {
  CardButton,
  CardButtonContent,
  CardButtonFooter,
  CardButtonHeader,
  CardButtonTitle,
} from '@kit/ui/card-button';

export function Default() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <CardButton>
        <CardButtonHeader>
          <CardButtonTitle>Midnight Frequency</CardButtonTitle>
        </CardButtonHeader>
      </CardButton>
      <CardButton>
        <CardButtonHeader>
          <CardButtonTitle>The Last Signal</CardButtonTitle>
        </CardButtonHeader>
      </CardButton>
      <CardButton>
        <CardButtonHeader>
          <CardButtonTitle>Echo Valley</CardButtonTitle>
        </CardButtonHeader>
      </CardButton>
    </div>
  );
}

export function WithContentAndFooter() {
  return (
    <div className="max-w-xs">
      <CardButton className="h-auto">
        <CardButtonHeader>
          <CardButtonTitle>Season 1</CardButtonTitle>
        </CardButtonHeader>
        <CardButtonContent>
          <p className="text-sm text-muted-foreground">
            12 episodes &middot; Documentary &middot; In production
          </p>
        </CardButtonContent>
        <CardButtonFooter className="h-auto py-3">
          <span className="text-xs text-muted-foreground">
            Last edited 2 hours ago
          </span>
        </CardButtonFooter>
      </CardButton>
    </div>
  );
}
