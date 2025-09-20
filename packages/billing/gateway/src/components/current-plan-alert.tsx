import { Enums } from '@kit/supabase/database';
import { Alert, AlertDescription, AlertTitle } from '@kit/ui/alert';
import { Trans } from '@kit/ui/trans';

const statusBadgeMap: Record<
  Enums<'subscription_status'>,
  `success` | `destructive` | `warning`
> = {
  active: 'success',
  trialing: 'success',
  past_due: 'destructive',
  canceled: 'destructive',
  unpaid: 'destructive',
  incomplete: 'warning',
  incomplete_expired: 'destructive',
  paused: 'warning',
};

export function CurrentPlanAlert(
  props: React.PropsWithoutRef<{
    status: Enums<'subscription_status'>;
  }>,
) {
  const prefix = 'billing:status';

  const text = `${prefix}.${props.status}.description`;
  const title = `${prefix}.${props.status}.heading`;
  const variant = statusBadgeMap[props.status];

  return (
    <Alert variant={variant}>
      <AlertTitle>
        <Trans i18nKey={title} />
      </AlertTitle>

      <AlertDescription>
        <Trans i18nKey={text} />
      </AlertDescription>
    </Alert>
  );
}
