---
spec_id: FILM-905
status: 🗑️ RETIRED
audited: 2026-09-23
---

# FILM-905: Generation Settings

> **🗑️ Retired (audit 2026-09-23).** The `/settings/generation` route, `generation-settings-form.tsx`, `generation-settings.schema.ts` and `settings-actions.ts` in `@kit/film-studio` were deleted by the owner in 5f44d0e1 (2026-02-19); the video generation they configured (provider, quality, aspect ratio, budget, concurrency, retries) was retired in 5b88db3a. Nothing replaces it: no user-facing settings for generation defaults, budgets or job notifications exist, and the surviving `accounts.monthly_budget_cents` column is only displayed on the admin account page (`apps/web/app/admin/accounts/[id]/page.tsx:42`). Kept as a record; not outstanding work.

## Metadata
- **Phase:** 9 - Integration
- **Priority:** P2 (Post-MVP)
- **Effort:** M (4-8 hours)
- **Dependencies:** FILM-401 (Video Provider), FILM-501 (Audio Provider)
- **Blocks:** None

---

## Context

The Generation Settings page allows users to configure default preferences for AI generation across their account or projects. This includes video quality, provider preferences, cost limits, and concurrent job limits.

---

## Specification

### Requirements

1. **Default Provider Selection**: Choose preferred video/audio provider
2. **Quality Settings**: Default quality level (standard/pro)
3. **Cost Controls**: Monthly budget limits and warnings
4. **Concurrency Limits**: Max simultaneous generation jobs
5. **Notification Preferences**: When to alert on job completion/failure
6. **Project Overrides**: Allow per-project setting overrides

### Generation Settings Page

```typescript
// apps/web/app/home/[account]/settings/generation/page.tsx

import { Metadata } from 'next';
import { withI18n } from '@kit/i18n/server';
import { GenerationSettings } from '@kit/film-studio/components/generation-settings';

export const metadata: Metadata = {
  title: 'Generation Settings | Settings',
  description: 'Configure AI generation preferences',
};

async function GenerationSettingsPage({ params }: { params: { account: string } }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Generation Settings</h1>
        <p className="text-muted-foreground">
          Configure default settings for AI video and audio generation.
        </p>
      </div>

      <GenerationSettings accountSlug={params.account} />
    </div>
  );
}

export default withI18n(GenerationSettingsPage);
```

### Generation Settings Component

```typescript
// packages/features/film-studio/src/components/generation-settings.tsx

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@kit/ui/card';
import { Button } from '@kit/ui/button';
import { Switch } from '@kit/ui/switch';
import { Slider } from '@kit/ui/slider';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import { toast } from '@kit/ui/sonner';
import { getGenerationSettingsAction, updateGenerationSettingsAction } from '../server/settings-actions';

const GenerationSettingsSchema = z.object({
  defaultVideoProvider: z.enum(['kling', 'runway', 'hailuo']),
  defaultVideoQuality: z.enum(['standard', 'pro']),
  defaultAspectRatio: z.enum(['16:9', '9:16', '1:1']),
  defaultAudioProvider: z.enum(['elevenlabs', 'playht']),
  defaultVoiceStability: z.number().min(0).max(1),
  monthlyBudgetCents: z.number().min(0),
  budgetWarningThreshold: z.number().min(0.5).max(1),
  maxConcurrentJobs: z.number().min(1).max(10),
  notifyOnCompletion: z.boolean(),
  notifyOnFailure: z.boolean(),
  autoRetryFailed: z.boolean(),
  maxAutoRetries: z.number().min(0).max(5),
});

type GenerationSettingsForm = z.infer<typeof GenerationSettingsSchema>;

interface GenerationSettingsProps {
  accountSlug: string;
}

export function GenerationSettings({ accountSlug }: GenerationSettingsProps) {
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['generation-settings', accountSlug],
    queryFn: getGenerationSettingsAction,
  });

  const form = useForm<GenerationSettingsForm>({
    resolver: zodResolver(GenerationSettingsSchema),
    values: settings,
  });

  const saveMutation = useMutation({
    mutationFn: updateGenerationSettingsAction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['generation-settings'] });
      toast.success('Settings saved successfully');
    },
    onError: (error) => {
      toast.error('Failed to save settings');
    },
  });

  const onSubmit = (data: GenerationSettingsForm) => {
    saveMutation.mutate(data);
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        {/* Video Generation */}
        <Card>
          <CardHeader>
            <CardTitle>Video Generation</CardTitle>
            <CardDescription>
              Default settings for AI video generation
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="defaultVideoProvider"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Default Provider</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select provider" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="kling">Kling (via PiAPI)</SelectItem>
                      <SelectItem value="runway">Runway Gen-3</SelectItem>
                      <SelectItem value="hailuo">Hailuo/MiniMax</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Choose which provider to use by default for new video generations.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="defaultVideoQuality"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Default Quality</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="standard">Standard (faster, lower cost)</SelectItem>
                      <SelectItem value="pro">Pro (slower, higher quality)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Pro quality takes longer but produces better results.
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
                  <FormLabel>Default Aspect Ratio</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="16:9">16:9 (YouTube, landscape)</SelectItem>
                      <SelectItem value="9:16">9:16 (TikTok, Reels, Shorts)</SelectItem>
                      <SelectItem value="1:1">1:1 (Instagram square)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Audio Generation */}
        <Card>
          <CardHeader>
            <CardTitle>Audio Generation</CardTitle>
            <CardDescription>
              Default settings for voice and music generation
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="defaultAudioProvider"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Voice Provider</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
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
              name="defaultVoiceStability"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Voice Stability: {Math.round(field.value * 100)}%</FormLabel>
                  <FormControl>
                    <Slider
                      value={[field.value]}
                      onValueChange={([v]) => field.onChange(v)}
                      min={0}
                      max={1}
                      step={0.05}
                    />
                  </FormControl>
                  <FormDescription>
                    Higher stability = more consistent voice, lower = more expressive.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Cost Controls */}
        <Card>
          <CardHeader>
            <CardTitle>Cost Controls</CardTitle>
            <CardDescription>
              Set budget limits and warnings for generation costs
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="monthlyBudgetCents"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Monthly Budget</FormLabel>
                  <FormControl>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">$</span>
                      <Input
                        type="number"
                        {...field}
                        value={field.value / 100}
                        onChange={(e) => field.onChange(parseFloat(e.target.value) * 100)}
                      />
                    </div>
                  </FormControl>
                  <FormDescription>
                    Maximum monthly spend on AI generation. Set to 0 for unlimited.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="budgetWarningThreshold"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Warning at {Math.round(field.value * 100)}% of budget
                  </FormLabel>
                  <FormControl>
                    <Slider
                      value={[field.value]}
                      onValueChange={([v]) => field.onChange(v)}
                      min={0.5}
                      max={1}
                      step={0.05}
                    />
                  </FormControl>
                  <FormDescription>
                    Receive a notification when you reach this percentage of your budget.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Job Management */}
        <Card>
          <CardHeader>
            <CardTitle>Job Management</CardTitle>
            <CardDescription>
              Configure how generation jobs are handled
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="maxConcurrentJobs"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Max Concurrent Jobs: {field.value}</FormLabel>
                  <FormControl>
                    <Slider
                      value={[field.value]}
                      onValueChange={([v]) => field.onChange(v)}
                      min={1}
                      max={10}
                      step={1}
                    />
                  </FormControl>
                  <FormDescription>
                    Limit how many generation jobs can run simultaneously.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="autoRetryFailed"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between">
                  <div>
                    <FormLabel>Auto-retry Failed Jobs</FormLabel>
                    <FormDescription>
                      Automatically retry jobs that fail due to temporary errors.
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

            {form.watch('autoRetryFailed') && (
              <FormField
                control={form.control}
                name="maxAutoRetries"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Max Auto-retries: {field.value}</FormLabel>
                    <FormControl>
                      <Slider
                        value={[field.value]}
                        onValueChange={([v]) => field.onChange(v)}
                        min={1}
                        max={5}
                        step={1}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </CardContent>
        </Card>

        {/* Notifications */}
        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
            <CardDescription>
              Choose when to receive notifications about generation jobs
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="notifyOnCompletion"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between">
                  <div>
                    <FormLabel>Notify on Completion</FormLabel>
                    <FormDescription>
                      Receive a notification when a job completes successfully.
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
                <FormItem className="flex items-center justify-between">
                  <div>
                    <FormLabel>Notify on Failure</FormLabel>
                    <FormDescription>
                      Receive a notification when a job fails.
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

        {/* Submit */}
        <div className="flex justify-end">
          <Button type="submit" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
```

### Server Actions

```typescript
// packages/features/film-studio/src/server/settings-actions.ts

'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { z } from 'zod';

const DEFAULT_SETTINGS = {
  defaultVideoProvider: 'kling',
  defaultVideoQuality: 'standard',
  defaultAspectRatio: '16:9',
  defaultAudioProvider: 'elevenlabs',
  defaultVoiceStability: 0.5,
  monthlyBudgetCents: 10000, // $100
  budgetWarningThreshold: 0.8,
  maxConcurrentJobs: 5,
  notifyOnCompletion: true,
  notifyOnFailure: true,
  autoRetryFailed: true,
  maxAutoRetries: 3,
};

export const getGenerationSettingsAction = enhanceAction(
  async (_, user) => {
    const client = getSupabaseServerClient();

    const { data: account } = await client
      .from('accounts')
      .select('settings')
      .eq('id', user.accountId)
      .single();

    return {
      ...DEFAULT_SETTINGS,
      ...account?.settings?.generation,
    };
  },
  { auth: true }
);

export const updateGenerationSettingsAction = enhanceAction(
  async (data, user) => {
    const client = getSupabaseServerClient();

    const { data: account } = await client
      .from('accounts')
      .select('settings')
      .eq('id', user.accountId)
      .single();

    const updatedSettings = {
      ...account?.settings,
      generation: data,
    };

    const { error } = await client
      .from('accounts')
      .update({ settings: updatedSettings })
      .eq('id', user.accountId);

    if (error) throw error;

    return { success: true };
  },
  {
    schema: z.object({
      defaultVideoProvider: z.enum(['kling', 'runway', 'hailuo']),
      defaultVideoQuality: z.enum(['standard', 'pro']),
      defaultAspectRatio: z.enum(['16:9', '9:16', '1:1']),
      defaultAudioProvider: z.enum(['elevenlabs', 'playht']),
      defaultVoiceStability: z.number().min(0).max(1),
      monthlyBudgetCents: z.number().min(0),
      budgetWarningThreshold: z.number().min(0.5).max(1),
      maxConcurrentJobs: z.number().min(1).max(10),
      notifyOnCompletion: z.boolean(),
      notifyOnFailure: z.boolean(),
      autoRetryFailed: z.boolean(),
      maxAutoRetries: z.number().min(0).max(5),
    }),
    auth: true,
  }
);
```

### File Changes

| Action | Path |
|--------|------|
| CREATE | `apps/web/app/home/[account]/settings/generation/page.tsx` |
| CREATE | `packages/features/film-studio/src/components/generation-settings.tsx` |
| CREATE | `packages/features/film-studio/src/server/settings-actions.ts` |

---

## Acceptance Criteria

- [x] Can select default video provider
- [x] Can select default quality level
- [x] Can select default aspect ratio
- [x] Can set monthly budget limit
- [x] Budget warning threshold configurable
- [x] Can limit concurrent jobs
- [x] Auto-retry toggle with max retries
- [x] Notification preferences saved
- [x] Settings persist across sessions
- [x] Form validates all inputs
- [x] Toast confirmation on save

---

## Test Plan

### Unit Tests
- [ ] Test default settings merging
- [ ] Test form validation

### Integration Tests
- [ ] Test settings save and retrieve
- [ ] Test settings apply to new generations
