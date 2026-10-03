'use client';

import { useTransition } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import { refusalMessage, unwrap } from '@kit/next/action-result';
import type { McpScope } from '@kit/studio-mcp';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Checkbox } from '@kit/ui/checkbox';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import { RadioGroup, RadioGroupItem } from '@kit/ui/radio-group';
import { toast } from '@kit/ui/sonner';

import { ApproveConsentSchema } from '../_lib/schemas/consent.schema';
import {
  approveConsentAction,
  denyConsentAction,
} from '../_lib/server/consent-actions';

const SCOPE_LABELS: Record<McpScope, { label: string; description: string }> = {
  'studio:read': {
    label: 'Read your studio',
    description: 'Projects, episodes, stage content, assets and analytics',
  },
  'studio:write': {
    label: 'Write to your studio',
    description:
      'Author inputs, run and submit generation, edit content and analytics notes',
  },
  'studio:render': {
    label: 'Start renders',
    description:
      'Voice, music and sound renders with ElevenLabs, which cost money',
  },
};

export interface ConsentTeam {
  id: string;
  name: string;
  slug: string;
}

/**
 * The consent page's form (FILM-1907): which team the client acts in, which
 * of the requested scopes it gets, approve or deny. Both outcomes end in a
 * redirect to the client's registered URI; the server action returns it and
 * the browser navigates, because the URI may be another origin or a
 * private-use scheme.
 */
export function ConsentForm(props: {
  query: string;
  clientName: string;
  clientId: string;
  metadataUrl: string | null;
  redirectHost: string;
  scopes: McpScope[];
  teams: ConsentTeam[];
  userEmail: string | null;
}) {
  const [isPending, startTransition] = useTransition();

  const form = useForm({
    resolver: zodResolver(ApproveConsentSchema),
    defaultValues: {
      query: props.query,
      accountId: props.teams[0]?.id ?? '',
      scopes: props.scopes,
    },
  });

  const approve = form.handleSubmit((values) => {
    startTransition(async () => {
      try {
        const { redirectTo } = await unwrap(approveConsentAction(values));

        window.location.assign(redirectTo);
      } catch (error) {
        toast.error(
          refusalMessage(error, 'Could not complete the request. Try again.'),
        );
      }
    });
  });

  const deny = () => {
    startTransition(async () => {
      try {
        const { redirectTo } = await unwrap(
          denyConsentAction({ query: props.query }),
        );

        window.location.assign(redirectTo);
      } catch (error) {
        toast.error(
          refusalMessage(error, 'Could not complete the request. Try again.'),
        );
      }
    });
  };

  return (
    <Card data-test="oauth-consent">
      <CardHeader>
        <CardTitle data-test="oauth-consent-client">
          {props.clientName} wants to connect to StoryBook
        </CardTitle>
        <CardDescription className="space-y-1">
          <span className="block">
            It will act as {props.userEmail ?? 'you'} in the team you choose,
            and will be sent back to <code>{props.redirectHost}</code>.
          </span>
          {props.metadataUrl ? (
            <span className="block text-xs">
              Identified by its published client document at{' '}
              <code className="break-all">{props.metadataUrl}</code>.
            </span>
          ) : (
            <span className="block text-xs">
              Client id <code className="break-all">{props.clientId}</code>
            </span>
          )}
        </CardDescription>
      </CardHeader>

      <Form {...form}>
        <form onSubmit={approve} data-test="oauth-consent-form">
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="accountId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Team</FormLabel>
                  <FormControl>
                    <RadioGroup
                      value={field.value}
                      onValueChange={field.onChange}
                      className="space-y-2"
                      data-test="oauth-consent-teams"
                    >
                      {props.teams.map((team) => (
                        <label
                          key={team.id}
                          className="flex items-center gap-3 rounded-md border p-3"
                        >
                          <RadioGroupItem
                            value={team.id}
                            data-test={`oauth-consent-team-${team.slug}`}
                          />
                          <span className="text-sm font-medium">
                            {team.name}
                          </span>
                        </label>
                      ))}
                    </RadioGroup>
                  </FormControl>
                  <FormMessage data-test="oauth-consent-team-error" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="scopes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Allow it to</FormLabel>
                  <div className="space-y-2">
                    {props.scopes.map((scope) => {
                      const checked = field.value.includes(scope);

                      return (
                        <label
                          key={scope}
                          className="flex items-start gap-3 rounded-md border p-3"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(next) =>
                              field.onChange(
                                next === true
                                  ? [...field.value, scope]
                                  : field.value.filter((s) => s !== scope),
                              )
                            }
                            data-test={`oauth-consent-scope-${scope.split(':')[1]}`}
                          />
                          <span className="space-y-0.5">
                            <span className="block text-sm font-medium">
                              {SCOPE_LABELS[scope].label}{' '}
                              <code className="text-xs text-muted-foreground">
                                {scope}
                              </code>
                            </span>
                            <span className="block text-sm text-muted-foreground">
                              {SCOPE_LABELS[scope].description}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <FormMessage data-test="oauth-consent-scopes-error" />
                </FormItem>
              )}
            />
          </CardContent>

          <CardFooter className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={deny}
              data-test="oauth-consent-deny"
            >
              Deny
            </Button>
            <Button
              type="submit"
              disabled={isPending || props.teams.length === 0}
              data-test="oauth-consent-approve"
            >
              {isPending ? 'Connecting…' : 'Allow'}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
