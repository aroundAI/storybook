'use client';

import { useTransition } from 'react';

import { isRedirectError } from 'next/dist/client/components/redirect-error';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { Button } from '@kit/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import { Input } from '@kit/ui/input';
import { toast } from '@kit/ui/sonner';
import { Trans } from '@kit/ui/trans';

import { TeamNameFormSchema } from '../../schema/update-team-name.schema';
import { updateTeamAccountName } from '../../server/actions/team-details-server-actions';

export const UpdateTeamAccountNameForm = (props: {
  account: {
    name: string;
    slug: string;
  };

  path: string;
}) => {
  const [pending, startTransition] = useTransition();
  const { t } = useTranslation('teams');

  const form = useForm({
    resolver: zodResolver(TeamNameFormSchema),
    defaultValues: {
      name: props.account.name,
    },
  });

  return (
    <div className={'space-y-8'}>
      <Form {...form}>
        <form
          data-test={'update-team-account-name-form'}
          className={'flex flex-col space-y-4'}
          onSubmit={form.handleSubmit((data) => {
            startTransition(async () => {
              const toastId = toast.loading(t('updateTeamLoadingMessage'));

              try {
                const result = await updateTeamAccountName({
                  slug: props.account.slug,
                  name: data.name,
                  path: props.path,
                });

                if (result.success) {
                  toast.success(t('updateTeamSuccessMessage'), {
                    id: toastId,
                  });
                } else {
                  toast.error(t('updateTeamErrorMessage'), {
                    id: toastId,
                  });
                }
              } catch (error) {
                if (!isRedirectError(error)) {
                  toast.error(t('updateTeamErrorMessage'), {
                    id: toastId,
                  });
                } else {
                  toast.success(t('updateTeamSuccessMessage'), {
                    id: toastId,
                  });
                }
              }
            });
          })}
        >
          <FormField
            name={'name'}
            render={({ field }) => {
              return (
                <FormItem>
                  <FormLabel>
                    <Trans i18nKey={'teams:teamNameInputLabel'} />
                  </FormLabel>

                  <FormControl>
                    <Input
                      data-test={'team-name-input'}
                      required
                      placeholder={''}
                      {...field}
                    />
                  </FormControl>

                  <FormMessage />
                </FormItem>
              );
            }}
          />

          <div>
            <Button
              className={'w-full md:w-auto'}
              data-test={'update-team-submit-button'}
              disabled={pending}
            >
              <Trans i18nKey={'teams:updateTeamSubmitLabel'} />
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
};
