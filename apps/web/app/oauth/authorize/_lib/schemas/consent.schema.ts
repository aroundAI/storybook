import { z } from 'zod';

import { McpScopesSchema } from '@kit/studio-mcp';

/**
 * What the consent form posts back (FILM-1907). `query` is the authorize
 * request's own query string, re-validated by the action against the
 * client registry before a code is minted: the page's rendering is never
 * trusted as proof the request was valid.
 */
export const ApproveConsentSchema = z.object({
  query: z.string().min(1).max(8192),
  accountId: z.string().uuid('Choose a team'),
  scopes: McpScopesSchema,
});

export type ApproveConsentInput = z.input<typeof ApproveConsentSchema>;

export const DenyConsentSchema = z.object({
  query: z.string().min(1).max(8192),
});
