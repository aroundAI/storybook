'use server';

import 'server-only';

import { enhanceAction } from '@kit/next/actions';
import { returnRefusals } from '@kit/next/refusals';

import { writeProjectJsonSetting } from '../../../_lib/server/write-project-json-setting';
import { UpdateProjectEditPolicySchema } from '../schemas/edit-policy-settings.schema';

const updateProjectEditPolicy = enhanceAction(
  async ({ projectId, editPolicy }, user) =>
    writeProjectJsonSetting({
      projectId,
      userId: user.id,
      column: 'edit_policy',
      value: editPolicy,
    }),
  { schema: UpdateProjectEditPolicySchema },
);

export const updateProjectEditPolicyAction = returnRefusals(
  updateProjectEditPolicy,
);
