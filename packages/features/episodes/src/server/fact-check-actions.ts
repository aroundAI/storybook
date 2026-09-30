'use server';

import { z } from 'zod';

import { checkRateLimit, enhanceAction } from '@kit/next/actions';
import { withRefusals } from '@kit/next/refusals';

import {
  runFactCheck,
  shouldBlockContent,
} from '../lib/documentary/fact-checker';

const FactCheckContentSchema = z.object({
  projectId: z.string().uuid(),
  content: z.string().min(1).max(100_000),
  requiredClaims: z.array(z.string().min(1)).max(50).optional(),
});

/**
 * Checks a piece of documentary content against the project's verified facts
 * (FILM-1123) and says whether it should be held back. Read-only: it never
 * changes a fact's status, so the human review of a fact (KB-18) is not
 * bypassed by it, and the verdict is advice a person acts on.
 */
const factCheckContent = enhanceAction(
  async (data: z.infer<typeof FactCheckContentSchema>, user) => {
    checkRateLimit(user.id, 'factCheckContent', {
      maxRequests: 20,
      windowMs: 60_000,
    });

    const result = await runFactCheck(
      data.projectId,
      data.content,
      data.requiredClaims,
    );

    return { result, blocked: shouldBlockContent(result) };
  },
  { schema: FactCheckContentSchema },
);

export const factCheckContentAction = withRefusals(
  'fact-check the content',
  factCheckContent,
);
