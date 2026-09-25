import { useCallback } from 'react';

import { requireAffectedRows } from '@kit/next/affected-rows';
import { useSupabase } from '@kit/supabase/hooks/use-supabase';

export function useDismissNotification() {
  const client = useSupabase();

  return useCallback(
    async (notification: number) => {
      const { data, error } = await client
        .from('notifications')
        .update({ dismissed: true })
        .eq('id', notification)
        .select('id');

      if (error) {
        throw error;
      }

      requireAffectedRows(data, "The notification wasn't dismissed.");
    },
    [client],
  );
}
