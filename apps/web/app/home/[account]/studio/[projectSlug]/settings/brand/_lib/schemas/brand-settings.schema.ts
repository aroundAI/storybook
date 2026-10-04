import { z } from 'zod';

import { BrandSchema } from '@kit/desktop-integration';

/** The Brand page's form and its action validate with the same schema. */
export const UpdateProjectBrandSchema = z.object({
  projectId: z.string().uuid(),
  brand: BrandSchema,
});
