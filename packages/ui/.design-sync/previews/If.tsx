import { Badge } from '@kit/ui/badge';
import { If } from '@kit/ui/if';

export function True() {
  const hasBillingData = true;

  return (
    <If condition={hasBillingData}>
      <div className="flex w-full max-w-sm flex-col space-y-2 rounded-lg border p-4">
        <p className="text-sm font-medium">Pro plan</p>
        <p className="text-sm text-muted-foreground">
          Renews on July 18, 2026. 4 of 10 seats used.
        </p>
      </div>
    </If>
  );
}

export function FallbackBranch() {
  const subscription = null;

  return (
    <If
      condition={subscription}
      fallback={
        <div className="flex w-full max-w-sm items-center justify-between rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">No active plan</p>
          <Badge variant="outline">Free tier</Badge>
        </div>
      }
    >
      <p className="text-sm">You have an active subscription.</p>
    </If>
  );
}
