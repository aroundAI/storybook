import { Tables } from '@kit/supabase/database';

export type Notification = Pick<
  Tables<'notifications'>,
  'id' | 'body' | 'dismissed' | 'type' | 'created_at' | 'link'
>;
