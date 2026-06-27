import { Badge } from '@kit/ui/badge';

export function Default() {
  return <Badge>Connected</Badge>;
}

export function Variants() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="default">Connected</Badge>
      <Badge variant="secondary">Draft</Badge>
      <Badge variant="destructive">Rejected</Badge>
      <Badge variant="outline">Not configured</Badge>
      <Badge variant="success">Validated</Badge>
      <Badge variant="warning">Pending review</Badge>
      <Badge variant="info">Processing</Badge>
    </div>
  );
}

export function StatusInContext() {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between rounded-lg border p-3">
        <span className="text-sm font-medium">Kling (via PiAPI)</span>
        <Badge variant="success">Connected</Badge>
      </div>
      <div className="flex items-center justify-between rounded-lg border p-3">
        <span className="text-sm font-medium">ElevenLabs</span>
        <Badge variant="outline">Not configured</Badge>
      </div>
      <div className="flex items-center justify-between rounded-lg border p-3">
        <span className="text-sm font-medium">Runway</span>
        <Badge variant="destructive">Invalid key</Badge>
      </div>
    </div>
  );
}
