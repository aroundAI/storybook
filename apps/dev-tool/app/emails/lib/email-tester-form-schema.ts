import { z } from 'zod';

export const EmailTesterFormSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  sender: z.string().min(1),
  to: z.string().email(),
  host: z.string().min(1),
  port: z.number().min(1),
  tls: z.boolean(),
});
