import { AlertCircle, CheckCircle2, Info } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@kit/ui/alert';

export function Default() {
  return (
    <Alert>
      <Info className="h-4 w-4" />
      <AlertTitle>Heads up</AlertTitle>
      <AlertDescription>
        Episode facts are extracted automatically once a season PDF finishes
        processing.
      </AlertDescription>
    </Alert>
  );
}

export function Variants() {
  return (
    <div className="flex flex-col gap-3">
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>API key invalid</AlertTitle>
        <AlertDescription>
          The Runway key you saved was rejected. Update it to resume video
          generation.
        </AlertDescription>
      </Alert>
      <Alert variant="success">
        <CheckCircle2 className="h-4 w-4" />
        <AlertTitle>Key validated</AlertTitle>
        <AlertDescription>
          Your ElevenLabs API key is connected and ready for narration.
        </AlertDescription>
      </Alert>
      <Alert variant="warning">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Approaching usage limit</AlertTitle>
        <AlertDescription>
          You&apos;ve used 92% of this month&apos;s audio generation quota.
        </AlertDescription>
      </Alert>
    </div>
  );
}

export function DescriptionOnly() {
  return (
    <Alert>
      <AlertDescription>
        Saving these canon settings will apply to all future episodes in this
        project.
      </AlertDescription>
    </Alert>
  );
}
