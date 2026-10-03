import { z } from 'zod';

import { McpScopesSchema } from '@kit/studio-mcp/scopes';

export const TOKEN_NAME_MAX = 100;

export const CreatePersonalAccessTokenSchema = z.object({
  accountSlug: z.string().min(1),
  name: z
    .string()
    .trim()
    .min(
      1,
      'Give the token a name, such as the device or script that will use it',
    )
    .max(TOKEN_NAME_MAX, `Use at most ${TOKEN_NAME_MAX} characters`),
  scopes: McpScopesSchema,
});

export type CreatePersonalAccessTokenInput = z.input<
  typeof CreatePersonalAccessTokenSchema
>;

export const RevokeMcpConnectionSchema = z.object({
  accountSlug: z.string().min(1),
  connectionId: z.string().uuid(),
});
