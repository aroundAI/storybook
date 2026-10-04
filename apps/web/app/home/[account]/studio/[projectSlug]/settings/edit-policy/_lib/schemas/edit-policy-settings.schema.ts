import { z } from 'zod';

import { EditPolicySchema } from '@kit/desktop-integration';

/** The Edit policy page's form and its action validate with the same schema. */
export const UpdateProjectEditPolicySchema = z.object({
  projectId: z.string().uuid(),
  editPolicy: EditPolicySchema,
});
