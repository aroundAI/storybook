import { useMutation } from '@tanstack/react-query';

import { requireAffectedRows } from '@kit/next/affected-rows';
import { Database } from '@kit/supabase/database';
import { useSupabase } from '@kit/supabase/hooks/use-supabase';

type UpdateData = Database['public']['Tables']['accounts']['Update'];

export function useUpdateAccountData(accountId: string) {
  const client = useSupabase();

  const mutationKey = ['account:data', accountId];

  const mutationFn = async (data: UpdateData) => {
    const response = await client
      .from('accounts')
      .update(data)
      .match({
        id: accountId,
      })
      .select('id');

    if (response.error) {
      throw response.error;
    }

    return requireAffectedRows(response.data, "Your account wasn't changed.");
  };

  return useMutation({
    mutationKey,
    mutationFn,
  });
}
