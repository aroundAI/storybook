import { Enums } from '@kit/supabase/database';
import { Badge } from '@kit/ui/badge';
import { Trans } from '@kit/ui/trans';

type Status = Enums<'subscription_status'> | Enums<'payment_status'>;

const statusBadgeMap: Record<Status, `success` | `destructive` | `warning`> = {
  active: 'success',
  succeeded: 'success',
  trialing: 'success',
  past_due: 'destructive',
  failed: 'destructive',
  canceled: 'destructive',
  unpaid: 'destructive',
  incomplete: 'warning',
  pending: 'warning',
  incomplete_expired: 'destructive',
  paused: 'warning',
};

export function CurrentPlanBadge(
  props: React.PropsWithoutRef<{
    status: Status;
  }>,
) {
  const text = `billing:status.${props.status}.badge`;
  const variant = statusBadgeMap[props.status];

  return (
    <Badge data-test={'current-plan-card-status-badge'} variant={variant}>
      <Trans i18nKey={text} />
    </Badge>
  );
}
