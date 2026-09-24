'use client';

import { useCallback, useTransition } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { BookOpen, Info, Loader2, Shield } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import type { CanonSettings } from '@kit/episodes';
import {
  DEFAULT_CANON_SETTINGS,
  MAX_MEMORY_HORIZON,
  MIN_MEMORY_HORIZON,
  PROJECT_TYPE_LABELS,
  contentTypeMemoryHorizon,
  savedMemoryHorizonOverride,
} from '@kit/episodes';
import type { ProjectType } from '@kit/film-studio-schemas/project';
import { refusalMessage, unwrap } from '@kit/next/action-result';
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
  // null = automatic: the content type's horizon applies (FILM-1110)
  memoryHorizon: z
    .number()
    .int()
    .min(MIN_MEMORY_HORIZON)
    .max(MAX_MEMORY_HORIZON)
    .nullable(),
  enforcement: z.enum(['flexible', 'strict']),
});

type CanonSettingsFormData = z.infer<typeof CanonSettingsSchema>;

interface CanonSettingsFormProps {
  projectId: string;
  projectType: ProjectType;
  currentSettings: CanonSettings | null | undefined;
}

export function CanonSettingsForm({
  projectId,
  projectType,
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
      memoryHorizon: savedMemoryHorizonOverride(currentSettings) ?? null,
      enforcement: settings.enforcement,
    },
  });

  const watchEnabled = form.watch('enabled');

  const onSubmit = useCallback(
    (data: CanonSettingsFormData) => {
      // The horizon is saved as a choice only if the user moved the slider;
      // otherwise whatever was loaded (usually automatic) is kept.
      const horizonMoved = form.getFieldState('memoryHorizon').isDirty;
      const memoryHorizon = horizonMoved
        ? data.memoryHorizon
        : (form.formState.defaultValues?.memoryHorizon ?? null);

      startTransition(async () => {
        try {
          await unwrap(
            updateCanonSettingsAction({
              projectId,
              settings: { ...data, memoryHorizon },
            }),
          );
          toast.success('Canon settings saved');
          form.reset(data);
        } catch (error) {
          toast.error(refusalMessage(error, 'Failed to save settings'));
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
                      data-test="canon-enabled-switch"
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

                {/* Content type: the project's, set when it was created (KB-71) */}
                <div className="space-y-1">
                  <Label>Content Type</Label>
                  <p
                    className="text-sm"
                    data-test="canon-settings-project-type"
                  >
                    {PROJECT_TYPE_LABELS[projectType]}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    The project&apos;s type, chosen when it was created. It sets
                    the automatic memory horizon and whether generation uses
                    verified facts.
                  </p>
                </div>

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
                    <MemoryHorizonField
                      value={field.value}
                      automaticHorizon={contentTypeMemoryHorizon(projectType)}
                      projectType={projectType}
                      onChange={field.onChange}
                      onReset={() =>
                        form.setValue('memoryHorizon', null, {
                          shouldDirty: true,
                        })
                      }
                    />
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
                data-test="canon-settings-save"
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

/**
 * The slider always shows the horizon generation will use: the user's
 * choice when there is one, otherwise the content type's.
 */
function MemoryHorizonField({
  value,
  automaticHorizon,
  projectType,
  onChange,
  onReset,
}: {
  value: number | null;
  automaticHorizon: number;
  projectType: ProjectType;
  onChange: (value: number) => void;
  onReset: () => void;
}) {
  const isAutomatic = value === null;
  const effective = value ?? automaticHorizon;
  const unit = effective === 1 ? 'episode' : 'episodes';
  const mode = isAutomatic
    ? `automatic, ${PROJECT_TYPE_LABELS[projectType]}`
    : 'custom';

  return (
    <FormItem>
      <div className="flex items-center justify-between gap-2">
        <FormLabel data-test="canon-memory-horizon-label">
          Memory Horizon: {effective} {unit} ({mode})
        </FormLabel>

        <If condition={!isAutomatic}>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0"
            onClick={onReset}
            data-test="canon-memory-horizon-reset"
          >
            Reset to automatic
          </Button>
        </If>
      </div>
      <FormControl>
        <Slider
          min={MIN_MEMORY_HORIZON}
          max={MAX_MEMORY_HORIZON}
          step={1}
          value={[effective]}
          onValueChange={([next]) => {
            if (next !== undefined) {
              onChange(next);
            }
          }}
          data-test="canon-memory-horizon-slider"
        />
      </FormControl>
      <FormDescription>
        How many prior episodes to consider for context. Automatic uses the
        project type&apos;s default.
      </FormDescription>
    </FormItem>
  );
}
