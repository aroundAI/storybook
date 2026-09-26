'use client';

import { useCallback } from 'react';

import { useTranslation } from 'react-i18next';

import { requireAffectedRows } from '@kit/next/affected-rows';
import { uploadAvatar } from '@kit/storage/client';
import { useSupabase } from '@kit/supabase/hooks/use-supabase';
import { ImageUploader } from '@kit/ui/image-uploader';
import { toast } from '@kit/ui/sonner';
import { Trans } from '@kit/ui/trans';

export function UpdateTeamAccountImage(props: {
  account: {
    id: string;
    name: string;
    pictureUrl: string | null;
  };
}) {
  const client = useSupabase();
  const { t } = useTranslation('teams');

  const createToaster = useCallback(
    (promise: () => Promise<unknown>) => {
      return toast.promise(promise, {
        success: t(`updateTeamSuccessMessage`),
        error: t(`updateTeamErrorMessage`),
        loading: t(`updateTeamLoadingMessage`),
      });
    },
    [t],
  );

  const onValueChange = useCallback(
    (file: File | null) => {
      if (file) {
        const promise = async () => {
          // Upload to R2 via presigned URL
          const result = await uploadAvatar(file, props.account.id);

          // Update the account record with new picture URL
          const { data } = await client
            .from('accounts')
            .update({
              picture_url: result.url,
            })
            .eq('id', props.account.id)
            .select('id')
            .throwOnError();

          requireAffectedRows(data, "The team picture wasn't changed.");
        };

        createToaster(promise);
      } else {
        const promise = async () => {
          const { data } = await client
            .from('accounts')
            .update({
              picture_url: null,
            })
            .eq('id', props.account.id)
            .select('id')
            .throwOnError();

          requireAffectedRows(data, "The team picture wasn't changed.");
        };

        createToaster(promise);
      }
    },
    [client, createToaster, props],
  );

  return (
    <ImageUploader
      value={props.account.pictureUrl}
      onValueChange={onValueChange}
    >
      <div className={'flex flex-col space-y-1'}>
        <span className={'text-sm'}>
          <Trans i18nKey={'account:profilePictureHeading'} />
        </span>

        <span className={'text-xs'}>
          <Trans i18nKey={'account:profilePictureSubheading'} />
        </span>
      </div>
    </ImageUploader>
  );
}
