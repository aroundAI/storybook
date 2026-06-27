import { ExternalLink, Plus } from 'lucide-react';

import { Button } from '@kit/ui/button';

export function Default() {
  return <Button>Save changes</Button>;
}

export function Variants() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="default">Default</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="link">Link</Button>
      <Button variant="generate">Generate</Button>
    </div>
  );
}

export function Sizes() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
      <Button size="icon" aria-label="Add">
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function WithIcon() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" size="sm">
        <Plus className="mr-2 h-4 w-4" />
        Add Key
      </Button>
      <Button variant="ghost" size="sm" asChild>
        <a href="https://example.com" target="_blank" rel="noopener noreferrer">
          <ExternalLink className="h-4 w-4" />
        </a>
      </Button>
    </div>
  );
}

export function Disabled() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button disabled>Default</Button>
      <Button variant="outline" disabled>
        Outline
      </Button>
    </div>
  );
}
