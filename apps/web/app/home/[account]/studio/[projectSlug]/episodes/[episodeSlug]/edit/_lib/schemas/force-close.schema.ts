import { z } from 'zod';

export const ForceCloseEditSessionSchema = z.object({
  sessionId: z.string().uuid(),
  /** The page to refresh once the session is closed. */
  path: z.string().startsWith('/home/'),
});
