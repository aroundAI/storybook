'use client';

import { useState, useTransition } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';

import { useSupabase } from '@kit/supabase/hooks/use-supabase';
import { Alert, AlertDescription, AlertTitle } from '@kit/ui/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@kit/ui/alert-dialog';
import { Button } from '@kit/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import { If } from '@kit/ui/if';
import { Input } from '@kit/ui/input';
import { LoadingOverlay } from '@kit/ui/loading-overlay';

import { impersonateUserAction } from '../lib/server/admin-server-actions';
import { ImpersonateUserSchema } from '../lib/server/schema/admin-actions.schema';

export function AdminImpersonateUserDialog(
  props: React.PropsWithChildren<{
    userId: string;
  }>,
) {
  const form = useForm({
    resolver: zodResolver(ImpersonateUserSchema),
    defaultValues: {
      userId: props.userId,
      confirmation: '',
    },
  });

  const [tokens, setTokens] = useState<{
    accessToken: string;
    refreshToken: string;
  }>();

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<boolean | null>(null);

  if (tokens) {
    return (
      <>
        <ImpersonateUserAuthSetter tokens={tokens} />

        <LoadingOverlay>Setting up your session...</LoadingOverlay>
      </>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{props.children}</AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Impersonate User</AlertDialogTitle>

          <AlertDialogDescription className={'flex flex-col space-y-1'}>
            <span>
              Are you sure you want to impersonate this user? You will be logged
              in as this user. To stop impersonating, log out.
            </span>

            <span>
              <b>NB:</b> If the user has 2FA enabled, you will not be able to
              impersonate them.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <Form {...form}>
          <form
            data-test={'admin-impersonate-user-form'}
            className={'flex flex-col space-y-8'}
            onSubmit={form.handleSubmit((data) => {
              startTransition(async () => {
                try {
                  const result = await impersonateUserAction(data);

                  setTokens(result);
                } catch {
                  setError(true);
                }
              });
            })}
          >
            <If condition={error}>
              <Alert variant={'destructive'}>
                <AlertTitle>Error</AlertTitle>

                <AlertDescription>
                  Failed to impersonate user. Please check the logs to
                  understand what went wrong.
                </AlertDescription>
              </Alert>
            </If>

            <FormField
              name={'confirmation'}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Type <b>CONFIRM</b> to confirm
                  </FormLabel>

                  <FormControl>
                    <Input
                      required
                      pattern={'CONFIRM'}
                      placeholder={'Type CONFIRM to confirm'}
                      {...field}
                    />
                  </FormControl>

                  <FormDescription>
                    Are you sure you want to impersonate this user?
                  </FormDescription>

                  <FormMessage />
                </FormItem>
              )}
            />

            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>

              <Button disabled={isPending} type={'submit'}>
                {isPending ? 'Impersonating...' : 'Impersonate User'}
              </Button>
            </AlertDialogFooter>
          </form>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ImpersonateUserAuthSetter({
  tokens,
}: React.PropsWithChildren<{
  tokens: {
    accessToken: string;
    refreshToken: string;
  };
}>) {
  useSetSession(tokens);

  return <LoadingOverlay>Setting up your session...</LoadingOverlay>;
}

function useSetSession(tokens: { accessToken: string; refreshToken: string }) {
  const supabase = useSupabase();

  return useQuery({
    queryKey: ['impersonate-user', tokens.accessToken, tokens.refreshToken],
    gcTime: 0,
    queryFn: async () => {
      // Deliberately no signOut() first. This dialog runs on
      // /admin/accounts/[id], and useAuthChangeListener sends any signed-out
      // visitor on a private path (/admin among them) straight to '/'. That
      // redirect fired the moment signOut() resolved and won the race against
      // the navigation below, so impersonation dropped the admin on the
      // marketing page instead of the impersonated user's dashboard.
      //
      // setSession replaces the stored session outright, so signing out first
      // bought nothing to begin with.
      await supabase.auth.setSession({
        refresh_token: tokens.refreshToken,
        access_token: tokens.accessToken,
      });

      // use a hard refresh to avoid hitting cached pages
      window.location.replace('/home');
    },
  });
}
