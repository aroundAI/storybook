'use client';

import { useCallback, useMemo } from 'react';

import { useRouter, useSearchParams } from 'next/navigation';

import type { ComponentInfo } from '../lib/components-data';
import { components } from '../lib/components-data';
import { DocsContent } from './docs-content';
import { DocsHeader } from './docs-header';
import { DocsSidebar } from './docs-sidebar';

export function DocsProvider() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Get current values from query params
  const componentId = searchParams.get('component');
  const categoryParam = searchParams.get('category');

  // Find the selected component based on query param, fallback to first component
  const selectedComponent = useMemo(() => {
    if (componentId) {
      const found = components.find((c) => c.id === componentId);
      if (found) return found;
    }
    return components[0];
  }, [componentId]);

  // Get selected category (null if 'all' or not set)
  const selectedCategory = useMemo(() => {
    return categoryParam && categoryParam !== 'all' ? categoryParam : null;
  }, [categoryParam]);

  // Update query params when component changes
  const handleComponentSelect = useCallback(
    (component: ComponentInfo) => {
      const params = new URLSearchParams(searchParams);
      params.set('component', component.id);

      // If we're selecting a component from a different category, clear category filter
      if (selectedCategory && component.category !== selectedCategory) {
        params.delete('category');
      }

      router.push(`?${params.toString()}`);
    },
    [router, searchParams, selectedCategory],
  );

  // Update query params when category changes
  const handleCategorySelect = useCallback(
    (category: string | null) => {
      const params = new URLSearchParams(searchParams);

      if (category) {
        params.set('category', category);

        // When selecting a category, auto-select the first component in that category
        const firstComponentInCategory = components.find(
          (c) => c.category === category,
        );
        if (firstComponentInCategory) {
          params.set('component', firstComponentInCategory.id);
        }
      } else {
        params.delete('category');
        // When showing all, select the first component overall
        params.set('component', components[0]!.id);
      }

      router.push(`?${params.toString()}`);
    },
    [router, searchParams],
  );

  if (!selectedComponent) {
    return null;
  }

  return (
    <div className="bg-background flex h-screen">
      <DocsSidebar
        selectedComponent={selectedComponent.id}
        selectedCategory={selectedCategory}
      />

      <div className="flex flex-1 flex-col">
        <DocsHeader selectedComponent={selectedComponent.id} />

        <DocsContent selectedComponent={selectedComponent.id} />
      </div>
    </div>
  );
}
