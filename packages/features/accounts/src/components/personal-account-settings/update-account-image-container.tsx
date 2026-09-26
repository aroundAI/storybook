'use client';

import { useCallback } from 'react';

import { useTranslation } from 'react-i18next';

import { requireAffectedRows } from '@kit/next/affected-rows';
import { uploadAvatar } from '@kit/storage/client';
import { useSupabase } from '@kit/supabase/hooks/use-supabase';
import { ImageUploader } from '@kit/ui/image-uploader';
import { toast } from '@kit/ui/sonner';
import { Trans } from '@kit/ui/trans';

import { useRevalidatePersonalAccountDataQuery } from '../../hooks/use-personal-account-data';

export function UpdateAccountImageContainer({
  user,
}: {
  user: {
    pictureUrl: string | null;
    id: string;
  };
}) {
  const revalidateUserDataQuery = useRevalidatePersonalAccountDataQuery();

  return (
    <UploadProfileAvatarForm
      pictureUrl={user.pictureUrl ?? null}
      userId={user.id}
      onAvatarUpdated={() => revalidateUserDataQuery(user.id)}
    />
  );
}

function UploadProfileAvatarForm(props: {
  pictureUrl: string | null;
  userId: string;
  onAvatarUpdated: () => void;
}) {
  const client = useSupabase();
  const { t } = useTranslation('account');

  const createToaster = useCallback(
    (promise: () => Promise<unknown>) => {
      return toast.promise(promise, {
        success: t(`updateProfileSuccess`),
        error: t(`updateProfileError`),
        loading: t(`updateProfileLoading`),
      });
    },
    [t],
  );

  const onValueChange = useCallback(
    (file: File | null) => {
      if (file) {
        const promise = async () => {
          // Upload to R2 via presigned URL
          const result = await uploadAvatar(file, props.userId);

          // Update the account record with new picture URL
          const { data } = await client
            .from('accounts')
            .update({
              picture_url: result.url,
            })
            .eq('id', props.userId)
            .select('id')
            .throwOnError();

          requireAffectedRows(data, "Your profile picture wasn't changed.");

          props.onAvatarUpdated();
        };

        createToaster(promise);
      } else {
        const promise = async () => {
          const { data } = await client
            .from('accounts')
            .update({
              picture_url: null,
            })
            .eq('id', props.userId)
            .select('id')
            .throwOnError();

          requireAffectedRows(data, "Your profile picture wasn't changed.");

          props.onAvatarUpdated();
        };

        createToaster(promise);
      }
    },
    [client, createToaster, props],
  );

  return (
    <ImageUploader value={props.pictureUrl} onValueChange={onValueChange}>
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
