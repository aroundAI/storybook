import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import { Switch } from '@kit/ui/switch';

export function Default() {
  return <Label htmlFor="project-name">Project name</Label>;
}

export function WithInput() {
  return (
    <div className="flex w-72 flex-col gap-y-2">
      <Label htmlFor="elevenlabs-key">ElevenLabs API Key</Label>
      <Input id="elevenlabs-key" type="password" placeholder="Enter API key" />
    </div>
  );
}

export function WithSwitch() {
  return (
    <div className="flex items-center gap-x-2">
      <Switch id="canon-enabled" checked />
      <Label htmlFor="canon-enabled">Enable Canon Tracking</Label>
    </div>
  );
}
