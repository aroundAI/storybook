'use client';

import { useTransition } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import {
  type EditPolicy,
  MAX_SILENCE_SECONDS_LIMIT,
  POLICY_CAPTION_STYLES,
  POLICY_DIALOGUE_CUTS,
  POLICY_TRANSITIONS,
} from '@kit/desktop-integration';
import { refusalMessage, unwrap } from '@kit/next/action-result';
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
import { toast } from '@kit/ui/sonner';

import {
  NumberField,
  SelectField,
  SwitchField,
} from '../../_components/settings-fields';
import { UpdateProjectEditPolicySchema } from '../_lib/schemas/edit-policy-settings.schema';
import { updateProjectEditPolicyAction } from '../_lib/server/actions';

const TRANSITION_LABEL: Record<(typeof POLICY_TRANSITIONS)[number], string> = {
  cut: 'Cut',
  dissolve: 'Dissolve',
  dip: 'Dip to colour',
};

const CAPTION_STYLE_OPTIONS = POLICY_CAPTION_STYLES.map((value) => ({
  value,
  label: value === 'brand' ? "The project's brand" : 'Plain',
}));

const DIALOGUE_CUT_LABEL: Record<
  (typeof POLICY_DIALOGUE_CUTS)[number],
  string
> = {
  never: 'Never drop dialogue',
  ask: 'Ask me for each drop',
  allow: 'Drop dialogue when needed',
};

const DIALOGUE_CUT_OPTIONS = POLICY_DIALOGUE_CUTS.map((value) => ({
  value,
  label: DIALOGUE_CUT_LABEL[value],
}));

export function EditPolicySettingsForm({
  projectId,
  editPolicy,
  canManage,
}: {
  projectId: string;
  editPolicy: EditPolicy;
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();

  const form = useForm({
    resolver: zodResolver(UpdateProjectEditPolicySchema),
    defaultValues: { projectId, editPolicy },
  });

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      try {
        await unwrap(updateProjectEditPolicyAction(values));
        form.reset(values);
        toast.success('Edit policy saved');
      } catch (error) {
        toast.error(refusalMessage(error, 'The edit policy was not saved.'));
      }
    }),
  );

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} data-test="edit-policy-settings-form">
        <fieldset disabled={!canManage || pending} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Length and pacing</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <NumberField
                name="editPolicy.targetDurationSeconds"
                label="Target duration (s)"
                description="Empty: each episode's own target. 60-7200."
                placeholder="Episode target"
                nullable
                dataTest="policy-target-duration"
              />
              <NumberField
                name="editPolicy.minShotLength"
                label="Shortest shot (s)"
                description="0.5-30."
                step={0.1}
                dataTest="policy-min-shot"
              />
              <NumberField
                name="editPolicy.maxShotLength"
                label="Longest shot (s)"
                description="0.5-30, at least the shortest."
                step={0.1}
                dataTest="policy-max-shot"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Dialogue and silence</CardTitle>
              <CardDescription>
                What the AI may do to reach the target duration, and what the
                quality check accepts.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <SelectField
                name="editPolicy.allowDialogueCuts"
                label="Dropping dialogue"
                description="Ask: the plan lists each drop for you to approve."
                dataTest="policy-dialogue-cuts"
                options={DIALOGUE_CUT_OPTIONS}
              />
              <NumberField
                name="editPolicy.maxSilenceSeconds"
                label="Longest silence (s)"
                description={`Above 0, up to ${MAX_SILENCE_SECONDS_LIMIT}. Longer silences fail the quality check.`}
                step={0.1}
                dataTest="policy-max-silence"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Transitions</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="editPolicy.transitions.preferred"
                render={({ field }) => {
                  const chosen = field.value ?? [];

                  return (
                    <FormItem>
                      <FormLabel>Allowed transitions</FormLabel>
                      <div className="flex flex-wrap gap-4">
                        {POLICY_TRANSITIONS.map((transition) => (
                          <label
                            key={transition}
                            className="flex items-center gap-2 text-sm"
                          >
                            <FormControl>
                              <Checkbox
                                data-test={`policy-transition-${transition}`}
                                checked={chosen.includes(transition)}
                                onCheckedChange={(checked) =>
                                  field.onChange(
                                    checked
                                      ? POLICY_TRANSITIONS.filter(
                                          (t) =>
                                            t === transition ||
                                            chosen.includes(t),
                                        )
                                      : chosen.filter((t) => t !== transition),
                                  )
                                }
                              />
                            </FormControl>
                            {TRANSITION_LABEL[transition]}
                          </label>
                        ))}
                      </div>
                      <FormDescription>
                        The AI uses only these between shots.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />
              <NumberField
                name="editPolicy.transitions.maxDuration"
                label="Longest transition (s)"
                description="0-2."
                step={0.05}
                dataTest="policy-transition-max"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Music and loudness</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <SwitchField
                name="editPolicy.music.enabled"
                label="Music"
                dataTest="policy-music-enabled"
              />
              <SwitchField
                name="editPolicy.music.duckUnderDialogue"
                label="Duck music under dialogue"
                dataTest="policy-music-duck"
              />
              <NumberField
                name="editPolicy.music.duckDb"
                label="Ducking (dB)"
                description="-40 to 0."
                dataTest="policy-music-duck-db"
              />
              <NumberField
                name="editPolicy.loudnessTargetLufs"
                label="Loudness target (LUFS)"
                description="-31 to -5. -14 suits YouTube."
                dataTest="policy-loudness"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Captions and visuals</CardTitle>
              <CardDescription>
                The brand caption style is set on the Brand page.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <SwitchField
                name="editPolicy.captions.enabled"
                label="Captions"
                dataTest="policy-captions-enabled"
              />
              <SelectField
                name="editPolicy.captions.style"
                label="Caption style"
                dataTest="policy-captions-style"
                options={CAPTION_STYLE_OPTIONS}
              />
              <SwitchField
                name="editPolicy.visual.avoidRepeatedShots"
                label="Avoid repeated shots"
                dataTest="policy-avoid-repeated"
              />
              <SwitchField
                name="editPolicy.visual.avoidExtremeZoom"
                label="Avoid extreme zoom"
                dataTest="policy-avoid-zoom"
              />
            </CardContent>
          </Card>

          <Button
            type="submit"
            data-test="edit-policy-save"
            disabled={!canManage || pending}
          >
            {pending ? 'Saving…' : 'Save edit policy'}
          </Button>
        </fieldset>
      </form>
    </Form>
  );
}
