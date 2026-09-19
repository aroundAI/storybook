import { Label } from '@kit/ui/label';
import { Switch } from '@kit/ui/switch';

export function Default() {
  return (
    <div className="flex items-center gap-2">
      <Switch id="canon-enabled" defaultChecked />
      <Label htmlFor="canon-enabled">Enable canon tracking</Label>
    </div>
  );
}

export function RecurringElement() {
  return (
    <div className="flex w-full max-w-sm items-center justify-between rounded-md border px-3 py-2">
      <div>
        <p className="text-sm font-medium">Cold open recap</p>
        <p className="text-xs text-muted-foreground">
          Repeat across every episode in this season
        </p>
      </div>
      <Switch defaultChecked />
    </div>
  );
}

export function Disabled() {
  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2">
        <Switch disabled />
        <Label className="text-muted-foreground">Off, disabled</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch disabled defaultChecked />
        <Label className="text-muted-foreground">On, disabled</Label>
      </div>
    </div>
  );
}
