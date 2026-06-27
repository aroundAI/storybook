import { Heading } from '@kit/ui/heading';

export function Default() {
  return <Heading level={1}>Page Not Found</Heading>;
}

export function Levels() {
  return (
    <div className="flex flex-col gap-y-3">
      <Heading level={1}>Create New Project</Heading>
      <Heading level={2}>Episode Settings</Heading>
      <Heading level={3}>Story & Narrative</Heading>
      <Heading level={4}>Shot List</Heading>
      <Heading level={5}>Audio Timeline</Heading>
      <Heading level={6}>Advanced Configuration</Heading>
    </div>
  );
}
