'use client';

import { Suspense } from 'react';

import { COMPONENTS_REGISTRY } from '../lib/components-data';
import { LoadingFallback } from './loading-fallback';

interface DocsContentProps {
  selectedComponent: string;
}

export function DocsContent({ selectedComponent }: DocsContentProps) {
  const component = COMPONENTS_REGISTRY.find(
    (c) => c.name === selectedComponent,
  );

  if (!component) {
    return null;
  }

  return (
    <div className="flex-1 overflow-auto">
      <Suspense fallback={<LoadingFallback />}>
        <div className="p-4">
          <component.component />
        </div>
      </Suspense>
    </div>
  );
}
