import { Stepper } from '@kit/ui/stepper';

export function Default() {
  return (
    <Stepper
      variant="default"
      currentStep={1}
      steps={['Premise & Bible', 'Assets', 'Generate']}
    />
  );
}

export function Numbers() {
  return (
    <Stepper
      variant="numbers"
      currentStep={1}
      steps={['Premise & Bible', 'Assets', 'Generate']}
    />
  );
}

export function Dots() {
  return <Stepper variant="dots" currentStep={2} steps={['1', '2', '3', '4']} />;
}
