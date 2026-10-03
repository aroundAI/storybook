import { useEffect } from 'react';

import { useSupabase } from '@kit/supabase/hooks/use-supabase';
import { subscribeWithAuth } from '@kit/supabase/realtime/subscribe-with-auth';

import { Notification } from '../types';

export function useNotificationsStream({
  onNotifications,
  accountIds,
  enabled,
}: {
  onNotifications: (notifications: Notification[]) => void;
  accountIds: string[];
  enabled: boolean;
}) {
  const client = useSupabase();

  useEffect(() => {
    if (!enabled) {
      return;
    }

    return subscribeWithAuth(client, (authed) =>
      authed.channel('notifications-channel').on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          filter: `account_id=in.(${accountIds.join(', ')})`,
          table: 'notifications',
        },
        (payload) => {
          onNotifications([payload.new as Notification]);
        },
      ),
    );
  }, [client, onNotifications, accountIds, enabled]);
}
