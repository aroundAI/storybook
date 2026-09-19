'use client';

import { Settings } from 'lucide-react';

import { Badge } from '@kit/ui/badge';

import { COMPONENTS_REGISTRY } from '../lib/components-data';

interface DocsHeaderProps {
  selectedComponent: string;
}

export function DocsHeader({ selectedComponent }: DocsHeaderProps) {
  const component = COMPONENTS_REGISTRY.find(
    (c) => c.name === selectedComponent,
  );

  if (!component) {
    return null;
  }

  return (
    <div className="border-b bg-muted/30 p-4">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-4">
              <h2 className="text-2xl font-bold">{component.name}</h2>

              <div className="mt-1 flex items-center gap-2">
                <Badge variant="outline">{component.category}</Badge>

                <Badge variant="secondary" className="text-xs">
                  {component.subcategory}
                </Badge>
              </div>
            </div>
          </div>

          <p className="max-w-2xl text-muted-foreground">
            {component.description}
          </p>

          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Settings className="h-4 w-4" />
              {component.props.length} props
            </span>

            <span className="flex items-center gap-1">
              {component.sourceFile}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
