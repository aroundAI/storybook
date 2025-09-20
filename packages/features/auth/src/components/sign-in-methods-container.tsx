'use client';

import { useCallback } from 'react';

import { useRouter } from 'next/navigation';

import type { Provider } from '@supabase/supabase-js';

import { isBrowser } from '@kit/shared/utils';
import { If } from '@kit/ui/if';
import { Separator } from '@kit/ui/separator';
import { Trans } from '@kit/ui/trans';

import { LastAuthMethodHint } from './last-auth-method-hint';
import { MagicLinkAuthContainer } from './magic-link-auth-container';
import { OauthProviders } from './oauth-providers';
import { OtpSignInContainer } from './otp-sign-in-container';
import { PasswordSignInContainer } from './password-sign-in-container';

export function SignInMethodsContainer(props: {
  inviteToken?: string;

  paths: {
    callback: string;
    joinTeam: string;
    returnPath: string;
  };

  providers: {
    password: boolean;
    magicLink: boolean;
    otp: boolean;
    oAuth: Provider[];
  };
}) {
  const router = useRouter();

  const redirectUrl = isBrowser()
    ? new URL(props.paths.callback, window?.location.origin).toString()
    : '';

  const onSignIn = useCallback(() => {
    // if the user has an invite token, we should join the team
    if (props.inviteToken) {
      const searchParams = new URLSearchParams({
        invite_token: props.inviteToken,
      });

      const joinTeamPath = props.paths.joinTeam + '?' + searchParams.toString();

      router.replace(joinTeamPath);
    } else {
      const returnPath = props.paths.returnPath || '/home';

      // otherwise, we should redirect to the return path
      router.replace(returnPath);
    }
  }, [props.inviteToken, props.paths.joinTeam, props.paths.returnPath, router]);

  return (
    <>
      <LastAuthMethodHint />

      <If condition={props.providers.password}>
        <PasswordSignInContainer onSignIn={onSignIn} />
      </If>

      <If condition={props.providers.magicLink}>
        <MagicLinkAuthContainer
          inviteToken={props.inviteToken}
          redirectUrl={redirectUrl}
          shouldCreateUser={false}
        />
      </If>

      <If condition={props.providers.otp}>
        <OtpSignInContainer
          inviteToken={props.inviteToken}
          shouldCreateUser={false}
        />
      </If>

      <If condition={props.providers.oAuth.length}>
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <Separator />
          </div>

          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background text-muted-foreground px-2">
              <Trans i18nKey="auth:orContinueWith" />
            </span>
          </div>
        </div>

        <OauthProviders
          enabledProviders={props.providers.oAuth}
          inviteToken={props.inviteToken}
          shouldCreateUser={false}
          paths={{
            callback: props.paths.callback,
            returnPath: props.paths.returnPath,
          }}
        />
      </If>
    </>
  );
}
