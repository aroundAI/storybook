'use client';

import { useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import { refusalMessage, unwrap } from '@kit/next/action-result';
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
import {
  RadioGroup,
  RadioGroupItem,
  RadioGroupItemLabel,
} from '@kit/ui/radio-group';
import { toast } from '@kit/ui/sonner';
import { Input } from '@kit/ui/input';
import { Switch } from '@kit/ui/switch';

import {
  type AiSettings,
  AiSettingsFormSchema,
  type AiSettingsFormValues,
  type GenerationMode,
  fromFormValues,
  toFormValues,
} from '../_lib/schemas/ai-settings.schema';
import { updateAccountAiSettingsAction } from '../_lib/server/actions';

const MODE_TOGGLES = [
  {
    name: 'serverGenerationEnabled',
    mode: 'server',
    label: 'Allow server generation',
    description:
      'Gemini writes in StoryBook when someone presses Generate on a studio page.',
    test: 'ai-settings-server',
  },
  {
    name: 'externalGenerationEnabled',
    mode: 'external',
    label: 'Allow external generation (MCP)',
    description:
      'A connected app such as Claude writes stages through StoryBook’s MCP connector.',
    test: 'ai-settings-external',
  },
] as const;

const MODE_LABELS: Record<GenerationMode, string> = {
  server: 'Server (Gemini in StoryBook)',
  external: 'External (an MCP client such as Claude)',
};

export function AiSettingsForm({
  accountSlug,
  settings,
  canEdit,
}: {
  accountSlug: string;
  settings: AiSettings;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const form = useForm({
    resolver: zodResolver(AiSettingsFormSchema),
    defaultValues: toFormValues(settings),
  });

  const disabled = !canEdit || isPending;

  const onSubmit = (values: AiSettingsFormValues) => {
    startTransition(async () => {
      try {
        const saved = await unwrap(
          updateAccountAiSettingsAction({
            accountSlug,
            ...fromFormValues(values),
          }),
        );
        form.reset(toFormValues(saved));
        toast.success('AI settings saved');
        router.refresh();
      } catch (error) {
        toast.error(refusalMessage(error, 'Could not save the AI settings'));
      }
    });
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-6"
        data-test="ai-settings-form"
      >
        {!canEdit && (
          <p
            className="rounded-md border bg-muted px-4 py-3 text-sm text-muted-foreground"
            data-test="ai-settings-read-only"
          >
            Only team owners can change these settings. You can see what the
            team allows.
          </p>
        )}

        {MODE_TOGGLES.map((toggle) => (
          <FormField
            key={toggle.name}
            control={form.control}
            name={toggle.name}
            render={({ field }) => (
              <FormItem className="rounded-lg border p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">{toggle.label}</FormLabel>
                    <FormDescription>{toggle.description}</FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      disabled={disabled}
                      data-test={toggle.test}
                      onCheckedChange={(checked) => {
                        field.onChange(checked);

                        // Turning off the default moves it to the other
                        // mode while that one is on, so only "both off"
                        // needs a refusal
                        const other =
                          toggle.mode === 'server' ? 'external' : 'server';
                        const otherOn = form.getValues(
                          other === 'server'
                            ? 'serverGenerationEnabled'
                            : 'externalGenerationEnabled',
                        );
                        if (
                          !checked &&
                          otherOn &&
                          form.getValues('defaultMode') === toggle.mode
                        ) {
                          form.setValue('defaultMode', other, {
                            shouldDirty: true,
                          });
                        }
                      }}
                    />
                  </FormControl>
                </div>
                <FormMessage data-test={`${toggle.test}-error`} />
              </FormItem>
            )}
          />
        ))}

        <FormField
          control={form.control}
          name="defaultMode"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Default mode</FormLabel>
              <FormDescription>
                The mode for a generation that does not choose one. Generate
                buttons in StoryBook always use Gemini, and a connected app
                always writes as itself.
              </FormDescription>
              <FormControl>
                <RadioGroup
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={disabled}
                  className="grid gap-2 sm:grid-cols-2"
                >
                  {(['server', 'external'] as const).map((mode) => (
                    <RadioGroupItemLabel
                      key={mode}
                      selected={field.value === mode}
                    >
                      <RadioGroupItem
                        value={mode}
                        data-test={`ai-settings-default-${mode}`}
                      />
                      <span>{MODE_LABELS[mode]}</span>
                    </RadioGroupItemLabel>
                  ))}
                </RadioGroup>
              </FormControl>
              <FormMessage data-test="ai-settings-default-error" />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="performanceContextEnabled"
          render={({ field }) => (
            <FormItem className="rounded-lg border p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <FormLabel className="text-base">
                    Use past episode performance in briefs
                  </FormLabel>
                  <FormDescription>
                    Ideation, story and shot briefs include what worked in this
                    project&apos;s earlier episodes, labelled with sample size.
                    Off by default.
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    disabled={disabled}
                    data-test="ai-settings-performance-context"
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </div>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="dailyLlmSpendCap"
          render={({ field }) => (
            <FormItem className="rounded-lg border p-4">
              <FormLabel className="text-base">
                Daily Gemini spend cap (USD)
              </FormLabel>
              <FormDescription>
                When the team&apos;s Gemini spend in StoryBook today reaches
                this, Generate is refused until 00:00 UTC. Leave it empty for
                no cap. A generation already running finishes, so a day can
                end a little over.
              </FormDescription>
              <FormDescription data-test="ai-settings-spend-cap-scope">
                Work Claude does through the MCP connector is never capped,
                and neither are ElevenLabs renders.
              </FormDescription>
              <FormControl>
                <Input
                  {...field}
                  inputMode="decimal"
                  placeholder="No cap"
                  className="max-w-40"
                  disabled={disabled}
                  data-test="ai-settings-spend-cap"
                />
              </FormControl>
              <FormMessage data-test="ai-settings-spend-cap-error" />
            </FormItem>
          )}
        />

        {canEdit && (
          <Button
            type="submit"
            disabled={isPending}
            data-test="ai-settings-save"
          >
            {isPending ? 'Saving…' : 'Save AI settings'}
          </Button>
        )}
      </form>
    </Form>
  );
}
