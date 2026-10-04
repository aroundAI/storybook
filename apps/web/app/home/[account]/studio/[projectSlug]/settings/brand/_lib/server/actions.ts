'use server';

import 'server-only';

import { findForeignBrandAssetIds } from '@kit/desktop-integration/server';
import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import { returnRefusals } from '@kit/next/refusals';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { writeProjectJsonSetting } from '../../../_lib/server/write-project-json-setting';
import { UpdateProjectBrandSchema } from '../schemas/brand-settings.schema';

const updateProjectBrand = enhanceAction(
  async ({ projectId, brand }, user) =>
    writeProjectJsonSetting({
      projectId,
      userId: user.id,
      column: 'brand',
      value: brand,
      check: async () => {
        const foreign = await findForeignBrandAssetIds(
          getSupabaseServerClient(),
          projectId,
          brand,
        );

        if (foreign.length > 0) {
          throw new ActionRefusal(
            'The logo, intro and outro must be assets of this project. Pick them again.',
          );
        }
      },
    }),
  { schema: UpdateProjectBrandSchema },
);

export const updateProjectBrandAction = returnRefusals(updateProjectBrand);
