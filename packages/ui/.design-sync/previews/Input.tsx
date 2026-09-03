import { Search } from 'lucide-react';

import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';

export function Default() {
  return <Input placeholder="Search projects..." className="w-64" />;
}

export function WithLabel() {
  return (
    <div className="flex w-72 flex-col gap-y-2">
      <Label htmlFor="api-key">OpenAI API Key</Label>
      <Input id="api-key" type="password" placeholder="sk-..." />
    </div>
  );
}

export function WithIcon() {
  return (
    <div className="relative w-64">
      <Search className="text-muted-foreground absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2" />
      <Input placeholder="Search projects..." className="pl-8" />
    </div>
  );
}

export function Disabled() {
  return <Input disabled placeholder="Disabled input" className="w-64" />;
}
