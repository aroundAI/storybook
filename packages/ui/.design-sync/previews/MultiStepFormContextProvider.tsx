import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@kit/ui/button';
import { Input } from '@kit/ui/input';
import {
  MultiStepForm,
  MultiStepFormContextProvider,
  MultiStepFormFooter,
  MultiStepFormHeader,
  MultiStepFormStep,
  createStepSchema,
} from '@kit/ui/multi-step-form';
import { Stepper } from '@kit/ui/stepper';

const EpisodeWizardSchema = createStepSchema({
  premise: z.object({
    title: z.string().min(1),
    logline: z.string().min(1),
  }),
  cast: z.object({
    leadCharacter: z.string().min(1),
  }),
});

// MultiStepForm calls useMutation (@tanstack/react-query) internally — the
// QueryClientProvider it needs is set up centrally in
// .design-sync/preview-background.tsx (bundled into the shared
// _ds_bundle.js, the same bundle cfg.storyImports.shim now routes
// MultiStepForm's own @kit/ui import through), not here.
export function Default() {
  const form = useForm({
    resolver: zodResolver(EpisodeWizardSchema),
    defaultValues: {
      premise: { title: 'The Last Frequency', logline: '' },
      cast: { leadCharacter: '' },
    },
  });

  return (
    <MultiStepForm
      schema={EpisodeWizardSchema}
      form={form}
      onSubmit={() => {}}
      className="bg-card min-h-[360px] rounded-lg border p-6"
    >
      <MultiStepFormHeader>
        <MultiStepFormContextProvider>
          {({ currentStepIndex }) => (
            <Stepper
              variant="numbers"
              currentStep={currentStepIndex}
              steps={['Premise', 'Cast & Roles']}
            />
          )}
        </MultiStepFormContextProvider>
      </MultiStepFormHeader>

      <MultiStepFormStep name="premise">
        <div className="flex flex-col gap-4 py-6">
          <h3 className="text-base font-semibold">Episode premise</h3>
          <Input defaultValue="The Last Frequency" placeholder="Title" />
          <Input placeholder="One-line logline" />
        </div>
      </MultiStepFormStep>

      <MultiStepFormStep name="cast">
        <div className="flex flex-col gap-4 py-6">
          <h3 className="text-base font-semibold">Lead character</h3>
          <Input placeholder="e.g. Mara Voss" />
        </div>
      </MultiStepFormStep>

      <MultiStepFormFooter>
        <MultiStepFormContextProvider>
          {({ isFirstStep, isLastStep, prevStep, nextStep }) => (
            <div className="flex justify-between border-t pt-4">
              <Button
                type="button"
                variant="outline"
                disabled={isFirstStep}
                onClick={prevStep}
              >
                Back
              </Button>
              <Button type="button" onClick={isLastStep ? undefined : nextStep}>
                {isLastStep ? 'Create episode' : 'Continue'}
              </Button>
            </div>
          )}
        </MultiStepFormContextProvider>
      </MultiStepFormFooter>
    </MultiStepForm>
  );
}
