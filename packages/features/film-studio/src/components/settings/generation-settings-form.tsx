'use client';

import { useTransition } from 'react';

import { isRedirectError } from 'next/dist/client/components/redirect-error';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { Slider } from '@kit/ui/slider';
import { toast } from '@kit/ui/sonner';
import { Switch } from '@kit/ui/switch';
import { Trans } from '@kit/ui/trans';

import {
  type GenerationSettings,
  GenerationSettingsSchema,
} from '../../schema/generation-settings.schema';
import { updateGenerationSettingsAction } from '../../server/actions/settings-actions';

interface GenerationSettingsFormProps {
  settings: GenerationSettings;
  accountId: string;
}

export function GenerationSettingsForm({
  settings,
  accountId,
}: GenerationSettingsFormProps) {
  const [isPending, startTransition] = useTransition();

  const form = useForm({
    resolver: zodResolver(GenerationSettingsSchema),
    defaultValues: settings,
  });

  const onSubmit = (data: GenerationSettings) => {
    startTransition(async () => {
      const toastId = toast.loading('Saving settings...');

      try {
        const result = await updateGenerationSettingsAction({
          ...data,
          accountId,
        });

        if (result.success) {
          toast.success('Settings saved successfully', { id: toastId });
        }
      } catch (error) {
        if (!isRedirectError(error)) {
          toast.error('Failed to save settings', { id: toastId });
        }
      }
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Video Provider Settings */}
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans i18nKey="generation:settings.videoProviders" />
            </CardTitle>
            <CardDescription>
              <Trans i18nKey="generation:settings.videoProvidersDescription" />
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="defaultVideoProvider"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    <Trans i18nKey="generation:settings.defaultVideoProvider" />
                  </FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select provider" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="kling">Kling</SelectItem>
                      <SelectItem value="runway">Runway</SelectItem>
                      <SelectItem value="luma">Luma</SelectItem>
                      <SelectItem value="hailuo">Hailuo</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="defaultVideoQuality"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    <Trans i18nKey="generation:settings.defaultVideoQuality" />
                  </FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select quality" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="standard">Standard</SelectItem>
                      <SelectItem value="pro">Professional</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    <Trans i18nKey="generation:settings.qualityDescription" />
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="defaultAspectRatio"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    <Trans i18nKey="generation:settings.defaultAspectRatio" />
                  </FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select aspect ratio" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
                      <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
                      <SelectItem value="1:1">1:1 (Square)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Audio Settings */}
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans i18nKey="generation:settings.audioSettings" />
            </CardTitle>
            <CardDescription>
              <Trans i18nKey="generation:settings.audioSettingsDescription" />
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="defaultAudioProvider"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    <Trans i18nKey="generation:settings.defaultAudioProvider" />
                  </FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select provider" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="elevenlabs">ElevenLabs</SelectItem>
                      <SelectItem value="playht">PlayHT</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="voiceStability"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    <Trans i18nKey="generation:settings.voiceStability" />
                  </FormLabel>
                  <FormControl>
                    <div className="flex items-center gap-4">
                      <Slider
                        min={0}
                        max={100}
                        step={1}
                        value={[field.value]}
                        onValueChange={(value) => field.onChange(value[0])}
                        className="flex-1"
                      />
                      <span className="text-muted-foreground w-12 text-sm">
                        {field.value}%
                      </span>
                    </div>
                  </FormControl>
                  <FormDescription>
                    <Trans i18nKey="generation:settings.voiceStabilityDescription" />
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Budget Controls */}
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans i18nKey="generation:settings.budgetControls" />
            </CardTitle>
            <CardDescription>
              <Trans i18nKey="generation:settings.budgetControlsDescription" />
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="monthlyBudgetCents"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    <Trans i18nKey="generation:settings.monthlyBudget" />
                  </FormLabel>
                  <FormControl>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">$</span>
                      <Input
                        type="number"
                        min={0}
                        max={10000}
                        step={10}
                        value={field.value / 100}
                        onChange={(e) =>
                          field.onChange(Number(e.target.value) * 100)
                        }
                        className="w-32"
                      />
                    </div>
                  </FormControl>
                  <FormDescription>
                    <Trans i18nKey="generation:settings.monthlyBudgetDescription" />
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="enableBudgetAlerts"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel>
                      <Trans i18nKey="generation:settings.enableBudgetAlerts" />
                    </FormLabel>
                    <FormDescription>
                      <Trans i18nKey="generation:settings.budgetAlertsDescription" />
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="budgetWarningThreshold"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    <Trans i18nKey="generation:settings.warningThreshold" />
                  </FormLabel>
                  <FormControl>
                    <div className="flex items-center gap-4">
                      <Slider
                        min={50}
                        max={95}
                        step={5}
                        value={[field.value]}
                        onValueChange={(value) => field.onChange(value[0])}
                        className="flex-1"
                      />
                      <span className="text-muted-foreground w-12 text-sm">
                        {field.value}%
                      </span>
                    </div>
                  </FormControl>
                  <FormDescription>
                    <Trans i18nKey="generation:settings.warningThresholdDescription" />
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Processing Settings */}
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans i18nKey="generation:settings.processingSettings" />
            </CardTitle>
            <CardDescription>
              <Trans i18nKey="generation:settings.processingSettingsDescription" />
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="maxConcurrentJobs"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    <Trans i18nKey="generation:settings.maxConcurrentJobs" />
                  </FormLabel>
                  <FormControl>
                    <div className="flex items-center gap-4">
                      <Slider
                        min={1}
                        max={10}
                        step={1}
                        value={[field.value]}
                        onValueChange={(value) => field.onChange(value[0])}
                        className="flex-1"
                      />
                      <span className="text-muted-foreground w-12 text-sm">
                        {field.value}
                      </span>
                    </div>
                  </FormControl>
                  <FormDescription>
                    <Trans i18nKey="generation:settings.maxConcurrentJobsDescription" />
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="enableAutoRetry"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel>
                      <Trans i18nKey="generation:settings.enableAutoRetry" />
                    </FormLabel>
                    <FormDescription>
                      <Trans i18nKey="generation:settings.autoRetryDescription" />
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="maxRetryAttempts"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    <Trans i18nKey="generation:settings.maxRetryAttempts" />
                  </FormLabel>
                  <Select
                    onValueChange={(v) => field.onChange(Number(v))}
                    defaultValue={String(field.value)}
                  >
                    <FormControl>
                      <SelectTrigger className="w-32">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="0">0 (Disabled)</SelectItem>
                      <SelectItem value="1">1</SelectItem>
                      <SelectItem value="2">2</SelectItem>
                      <SelectItem value="3">3</SelectItem>
                      <SelectItem value="4">4</SelectItem>
                      <SelectItem value="5">5</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Notification Preferences */}
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans i18nKey="generation:settings.notifications" />
            </CardTitle>
            <CardDescription>
              <Trans i18nKey="generation:settings.notificationsDescription" />
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="notifyOnCompletion"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel>
                      <Trans i18nKey="generation:settings.notifyOnCompletion" />
                    </FormLabel>
                    <FormDescription>
                      <Trans i18nKey="generation:settings.notifyOnCompletionDescription" />
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notifyOnFailure"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel>
                      <Trans i18nKey="generation:settings.notifyOnFailure" />
                    </FormLabel>
                    <FormDescription>
                      <Trans i18nKey="generation:settings.notifyOnFailureDescription" />
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notifyViaEmail"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel>
                      <Trans i18nKey="generation:settings.notifyViaEmail" />
                    </FormLabel>
                    <FormDescription>
                      <Trans i18nKey="generation:settings.notifyViaEmailDescription" />
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Submit Button */}
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={isPending}
            data-test="save-generation-settings"
          >
            {isPending ? (
              <Trans i18nKey="common:saving" />
            ) : (
              <Trans i18nKey="common:saveSettings" />
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
