import { Label } from '@kit/ui/label';
import { Textarea } from '@kit/ui/textarea';

export function Default() {
  return (
    <div className="w-full max-w-md space-y-2">
      <Label htmlFor="source-description">Description</Label>
      <Textarea
        id="source-description"
        placeholder="Brief description of this source..."
        rows={2}
      />
    </div>
  );
}

export function WithValue() {
  return (
    <div className="w-full max-w-md space-y-2">
      <Label htmlFor="direction-notes">Season direction notes</Label>
      <Textarea
        id="direction-notes"
        rows={4}
        defaultValue="Lean into the slow-burn mystery in episodes 3-5. Keep the detective's backstory ambiguous until the season finale reveal."
      />
    </div>
  );
}

export function Disabled() {
  return (
    <div className="w-full max-w-md space-y-2">
      <Label htmlFor="locked-notes">Locked notes</Label>
      <Textarea
        id="locked-notes"
        rows={3}
        disabled
        defaultValue="This season's notes are locked while the finale is in review."
      />
    </div>
  );
}
