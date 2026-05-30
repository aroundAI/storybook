'use client';

import { useCallback, useTransition } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { BookOpen, Info, Loader2, Shield } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import type { CanonSettings } from '@kit/episodes';
import { DEFAULT_CANON_SETTINGS } from '@kit/episodes';
import { Alert, AlertDescription } from '@kit/ui/alert';
import { Badge } from '@kit/ui/badge';
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
} from '@kit/ui/form';
import { If } from '@kit/ui/if';
import { Label } from '@kit/ui/label';
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

import { updateCanonSettingsAction } from './canon-settings-actions';

// Form schema
const CanonSettingsSchema = z.object({
  enabled: z.boolean(),
  roleSeparation: z.boolean(),
  memoryHorizon: z.number().min(1).max(20),
  enforcement: z.enum(['flexible', 'strict']),
  contentType: z.enum(['series', 'movie', 'factual', 'news']),
});

type CanonSettingsFormData = z.infer<typeof CanonSettingsSchema>;

interface CanonSettingsFormProps {
  projectId: string;
  currentSettings: CanonSettings | null | undefined;
}

export function CanonSettingsForm({
  projectId,
  currentSettings,
}: CanonSettingsFormProps) {
  const [isPending, startTransition] = useTransition();

  const settings: CanonSettings = {
    ...DEFAULT_CANON_SETTINGS,
    ...currentSettings,
  };

  const form = useForm<CanonSettingsFormData>({
    resolver: zodResolver(CanonSettingsSchema),
    defaultValues: {
      enabled: settings.enabled,
      roleSeparation: settings.roleSeparation,
      memoryHorizon: settings.memoryHorizon,
      enforcement: settings.enforcement,
      contentType: settings.contentType,
    },
  });

  const watchEnabled = form.watch('enabled');

  const onSubmit = useCallback(
    (data: CanonSettingsFormData) => {
      startTransition(async () => {
        try {
          await updateCanonSettingsAction({
            projectId,
            settings: data,
          });
          toast.success('Canon settings saved');
          form.reset(data);
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : 'Failed to save settings',
          );
        }
      });
    },
    [projectId, form],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="h-5 w-5" />
          Canon Management
          <Badge variant="outline">Beta</Badge>
        </CardTitle>
        <CardDescription>
          Maintain story continuity and consistency across episodes
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Enable Canon Toggle */}
            <FormField
              control={form.control}
              name="enabled"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">
                      Enable Canon Tracking
                    </FormLabel>
                    <FormDescription>
                      Track immutable events, character states, and narrative
                      threads
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

            {/* Advanced Settings (only shown when enabled) */}
            <If condition={watchEnabled}>
              <div className="space-y-4 rounded-lg border p-4">
                <Label className="text-sm font-medium">
                  Advanced Configuration
                </Label>

                {/* Content Type */}
                <FormField
                  control={form.control}
                  name="contentType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Content Type</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select content type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="series">
                            Series (Multi-episode)
                          </SelectItem>
                          <SelectItem value="movie">
                            Movie (Single narrative)
                          </SelectItem>
                          <SelectItem value="factual">
                            Factual / Documentary
                          </SelectItem>
                          <SelectItem value="news">
                            News / Current Events
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        Affects how strictly canon rules are applied
                      </FormDescription>
                    </FormItem>
                  )}
                />

                {/* Enforcement Level */}
                <FormField
                  control={form.control}
                  name="enforcement"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Enforcement Level</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select enforcement" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="flexible">
                            <div className="flex items-center gap-2">
                              <Shield className="h-4 w-4 text-amber-500" />
                              Flexible - Warn on violations
                            </div>
                          </SelectItem>
                          <SelectItem value="strict">
                            <div className="flex items-center gap-2">
                              <Shield className="h-4 w-4 text-red-500" />
                              Strict - Block violations
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />

                {/* Memory Horizon */}
                <FormField
                  control={form.control}
                  name="memoryHorizon"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Memory Horizon: {field.value} episodes
                      </FormLabel>
                      <FormControl>
                        <Slider
                          min={1}
                          max={20}
                          step={1}
                          value={[field.value]}
                          onValueChange={([value]) => field.onChange(value)}
                        />
                      </FormControl>
                      <FormDescription>
                        How many prior episodes to consider for context
                      </FormDescription>
                    </FormItem>
                  )}
                />

                {/* Role Separation */}
                <FormField
                  control={form.control}
                  name="roleSeparation"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                      <div className="space-y-0.5">
                        <FormLabel>LLM Role Separation</FormLabel>
                        <FormDescription>
                          Use multi-pass generation (Planner → Writer → Editor)
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
              </div>

              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  Canon events are recorded automatically during story
                  generation. You can view and edit the canon timeline in each
                  episode.
                </AlertDescription>
              </Alert>
            </If>

            {/* Save Button */}
            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={isPending || !form.formState.isDirty}
              >
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
