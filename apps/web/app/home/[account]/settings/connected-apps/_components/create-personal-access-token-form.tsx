'use client';

import { useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import { refusalMessage, unwrap } from '@kit/next/action-result';
import { MCP_SCOPES, type McpScope } from '@kit/studio-mcp';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Checkbox } from '@kit/ui/checkbox';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import { Input } from '@kit/ui/input';
import { toast } from '@kit/ui/sonner';

import { CreatePersonalAccessTokenSchema } from '../_lib/schemas/connected-apps.schema';
import { createPersonalAccessTokenAction } from '../_lib/server/actions';
import { NewTokenReveal } from './new-token-reveal';

const SCOPE_LABELS: Record<McpScope, { label: string; description: string }> = {
  'studio:read': {
    label: 'Read',
    description: 'Projects, episodes, stage content, assets and analytics',
  },
  'studio:write': {
    label: 'Write',
    description: 'Author inputs, run generation and edit content',
  },
  'studio:render': {
    label: 'Render',
    description: 'Start voice, music and sound renders, which cost money',
  },
};

const DEFAULTS = { name: '', scopes: ['studio:read'] as McpScope[] };

export function CreatePersonalAccessTokenForm(props: { accountSlug: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [reveal, setReveal] = useState<{ token: string; name: string } | null>(
    null,
  );

  const form = useForm({
    resolver: zodResolver(CreatePersonalAccessTokenSchema),
    defaultValues: { accountSlug: props.accountSlug, ...DEFAULTS },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      try {
        const { token, connection } = await unwrap(
          createPersonalAccessTokenAction(values),
        );

        form.reset({ accountSlug: props.accountSlug, ...DEFAULTS });
        setReveal({ token, name: connection.name });
        router.refresh();
      } catch (error) {
        toast.error(
          refusalMessage(error, 'Could not create the token. Try again.'),
        );
      }
    });
  });

  return (
    <Card data-test="pat-create-card">
      <CardHeader>
        <CardTitle>New personal access token</CardTitle>
        <CardDescription>
          A token lets an MCP client such as Claude Desktop act as you in this
          team. It is shown once, when created.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {reveal ? (
          <NewTokenReveal
            token={reveal.token}
            name={reveal.name}
            onDismiss={() => setReveal(null)}
          />
        ) : null}

        <Form {...form}>
          <form
            onSubmit={onSubmit}
            className="space-y-6"
            data-test="pat-create-form"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Claude Desktop on my laptop"
                      autoComplete="off"
                      data-test="pat-name-input"
                    />
                  </FormControl>
                  <FormDescription>
                    Where this token will be used, so you recognise it later.
                  </FormDescription>
                  <FormMessage data-test="pat-name-error" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="scopes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Scopes</FormLabel>
                  <div className="space-y-3">
                    {MCP_SCOPES.map((scope) => {
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
                            data-test={`pat-scope-${scope.split(':')[1]}`}
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
                  <FormMessage data-test="pat-scopes-error" />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              disabled={isPending}
              data-test="pat-create-submit"
            >
              {isPending ? 'Creating…' : 'Create token'}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
