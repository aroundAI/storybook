# FILM-204: Asset Gallery Component

**Status**: ✅ Completed (2025-12-08)
**Phase**: 2
**Priority**: P0
**Effort**: M (3-5 days)
**Dependencies**: FILM-201 (asset CRUD actions)
**Blocks**: FILM-208 (Asset Library Page)

---

## Context

The Asset Gallery provides a visual interface for viewing and managing all assets in a project. It displays assets in a tabbed interface organized by type (characters, locations, voices) with a grid of asset cards. Each card shows a thumbnail, asset name, and quick actions (edit, delete).

This component serves as the primary navigation point for the asset management system and integrates with CharacterEditor, LocationEditor, and VoiceProfileEditor components through modal dialogs.

---

## Requirements

### Functional Requirements

1. **Tabbed Interface**
   - Three tabs: Characters, Locations, Voices
   - Active tab indicator
   - Persist selected tab in URL query parameter
   - Load assets for active tab only

2. **Asset Grid**
   - Responsive grid layout (1-4 columns based on viewport)
   - Display asset cards with thumbnail, name, description preview
   - Skeleton loading state while fetching
   - Empty state with "Create First Asset" CTA
   - Infinite scroll or "Load More" pagination

3. **Asset Card**
   - Thumbnail image (256x256) or placeholder icon
   - Asset name (truncated to 2 lines)
   - Description preview (truncated to 1 line)
   - Quick action buttons (Edit, Delete)
   - Hover effects for interactivity

4. **Search & Filter**
   - Search by asset name
   - Debounced search input (300ms)
   - Clear search button
   - Filter results in real-time

5. **Actions**
   - Create new asset (opens editor modal)
   - Edit asset (opens editor modal with prefilled data)
   - Delete asset (confirmation dialog)
   - Optimistic UI updates

### Non-Functional Requirements

- Render 50 assets within 500ms
- Smooth scrolling and animations
- Keyboard navigation support
- Accessible (ARIA labels, focus management)
- Mobile-responsive design

---

## Interface

### Component Props

```typescript
interface AssetGalleryProps {
  projectId: string;
  initialTab?: 'character' | 'location' | 'voice';
  onAssetSelect?: (assetId: string) => void;
}
```

### Child Components

```typescript
interface AssetCardProps {
  asset: Asset;
  onEdit: (assetId: string) => void;
  onDelete: (assetId: string) => void;
}

interface AssetGridProps {
  assets: Asset[];
  isLoading: boolean;
  onEdit: (assetId: string) => void;
  onDelete: (assetId: string) => void;
}

interface EmptyStateProps {
  assetType: 'character' | 'location' | 'voice';
  onCreate: () => void;
}
```

---

## Implementation

### Component Structure

```
packages/features/assets/src/components/
├── AssetGallery.tsx                # Main gallery component (CREATE THIS)
├── AssetGrid.tsx                   # Grid container (CREATE THIS)
├── AssetCard.tsx                   # Individual asset card (CREATE THIS)
├── AssetTabs.tsx                   # Tab navigation (CREATE THIS)
├── AssetSearchBar.tsx              # Search input (CREATE THIS)
└── EmptyAssetState.tsx             # Empty state CTA (CREATE THIS)
```

### Main Component

**File**: `packages/features/assets/src/components/AssetGallery.tsx`

```typescript
'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from '@kit/ui/sonner';
import { AssetTabs } from './AssetTabs';
import { AssetSearchBar } from './AssetSearchBar';
import { AssetGrid } from './AssetGrid';
import { EmptyAssetState } from './EmptyAssetState';
import { getProjectAssetsAction, deleteAssetAction } from '../lib/server/mutations/asset-actions';
import { Asset } from '../types/asset.types';

interface AssetGalleryProps {
  projectId: string;
  initialTab?: 'character' | 'location' | 'voice';
  onAssetSelect?: (assetId: string) => void;
}

export function AssetGallery({
  projectId,
  initialTab = 'character',
  onAssetSelect,
}: AssetGalleryProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  // Get active tab from URL or use initial
  const activeTab = (searchParams.get('tab') as Asset['type']) ?? initialTab;

  // Search state
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch assets for active tab
  const { data, isLoading } = useQuery({
    queryKey: ['assets', projectId, activeTab],
    queryFn: () =>
      getProjectAssetsAction({
        projectId,
        type: activeTab,
        limit: 50,
        offset: 0,
      }),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Filter assets by search query
  const filteredAssets = useMemo(() => {
    if (!data?.assets) return [];

    if (!searchQuery) return data.assets;

    const query = searchQuery.toLowerCase();
    return data.assets.filter(
      (asset) =>
        asset.name.toLowerCase().includes(query) ||
        asset.description?.toLowerCase().includes(query)
    );
  }, [data?.assets, searchQuery]);

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (assetId: string) => deleteAssetAction({ assetId }),
    onMutate: async (assetId) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: ['assets', projectId, activeTab] });

      const previous = queryClient.getQueryData(['assets', projectId, activeTab]);

      queryClient.setQueryData(['assets', projectId, activeTab], (old: any) => ({
        ...old,
        assets: old.assets.filter((a: Asset) => a.id !== assetId),
        total: old.total - 1,
      }));

      return { previous };
    },
    onError: (error, variables, context) => {
      // Rollback on error
      if (context?.previous) {
        queryClient.setQueryData(
          ['assets', projectId, activeTab],
          context.previous
        );
      }

      if (error.message.includes('in use')) {
        toast.error('Cannot delete asset that is in use by episodes');
      } else {
        toast.error('Failed to delete asset');
      }
    },
    onSuccess: () => {
      toast.success('Asset deleted successfully');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['assets', projectId, activeTab] });
    },
  });

  // Handle tab change
  const handleTabChange = (tab: Asset['type']) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', tab);
    router.push(`?${params.toString()}`);
  };

  // Handle delete with confirmation
  const handleDelete = async (assetId: string) => {
    const confirmed = window.confirm(
      'Are you sure you want to delete this asset? This action cannot be undone.'
    );

    if (confirmed) {
      deleteMutation.mutate(assetId);
    }
  };

  // Handle edit
  const handleEdit = (assetId: string) => {
    if (onAssetSelect) {
      onAssetSelect(assetId);
    } else {
      router.push(`/assets/${assetId}/edit`);
    }
  };

  // Handle create
  const handleCreate = () => {
    router.push(`/assets/new?type=${activeTab}`);
  };

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <AssetTabs activeTab={activeTab} onChange={handleTabChange} />

      {/* Search Bar */}
      <AssetSearchBar value={searchQuery} onChange={setSearchQuery} />

      {/* Grid or Empty State */}
      {isLoading ? (
        <AssetGrid
          assets={[]}
          isLoading={true}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
      ) : filteredAssets.length > 0 ? (
        <AssetGrid
          assets={filteredAssets}
          isLoading={false}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
      ) : searchQuery ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">
            No assets found matching "{searchQuery}"
          </p>
        </div>
      ) : (
        <EmptyAssetState assetType={activeTab} onCreate={handleCreate} />
      )}
    </div>
  );
}
```

### Asset Tabs

**File**: `packages/features/assets/src/components/AssetTabs.tsx`

```typescript
'use client';

import { Tabs, TabsList, TabsTrigger } from '@kit/ui/tabs';
import { User, MapPin, Mic } from 'lucide-react';

interface AssetTabsProps {
  activeTab: 'character' | 'location' | 'voice';
  onChange: (tab: 'character' | 'location' | 'voice') => void;
}

export function AssetTabs({ activeTab, onChange }: AssetTabsProps) {
  return (
    <Tabs value={activeTab} onValueChange={onChange}>
      <TabsList>
        <TabsTrigger value="character">
          <User className="mr-2 h-4 w-4" />
          Characters
        </TabsTrigger>
        <TabsTrigger value="location">
          <MapPin className="mr-2 h-4 w-4" />
          Locations
        </TabsTrigger>
        <TabsTrigger value="voice">
          <Mic className="mr-2 h-4 w-4" />
          Voices
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
```

### Search Bar

**File**: `packages/features/assets/src/components/AssetSearchBar.tsx`

```typescript
'use client';

import { useState, useEffect } from 'react';
import { Input } from '@kit/ui/input';
import { Search, X } from 'lucide-react';
import { Button } from '@kit/ui/button';

interface AssetSearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

export function AssetSearchBar({ value, onChange }: AssetSearchBarProps) {
  const [localValue, setLocalValue] = useState(value);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      onChange(localValue);
    }, 300);

    return () => clearTimeout(timer);
  }, [localValue, onChange]);

  // Sync with external value changes
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        type="text"
        placeholder="Search assets..."
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        className="pl-9 pr-9"
      />
      {localValue && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
          onClick={() => {
            setLocalValue('');
            onChange('');
          }}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Clear search</span>
        </Button>
      )}
    </div>
  );
}
```

### Asset Grid

**File**: `packages/features/assets/src/components/AssetGrid.tsx`

```typescript
'use client';

import { AssetCard } from './AssetCard';
import { AssetCardSkeleton } from './AssetCardSkeleton';
import { Asset } from '../types/asset.types';

interface AssetGridProps {
  assets: Asset[];
  isLoading: boolean;
  onEdit: (assetId: string) => void;
  onDelete: (assetId: string) => void;
}

export function AssetGrid({ assets, isLoading, onEdit, onDelete }: AssetGridProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <AssetCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {assets.map((asset) => (
        <AssetCard
          key={asset.id}
          asset={asset}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
```

### Asset Card

**File**: `packages/features/assets/src/components/AssetCard.tsx`

```typescript
'use client';

import { Card, CardContent, CardFooter } from '@kit/ui/card';
import { Button } from '@kit/ui/button';
import { Edit, Trash2, User, MapPin, Mic } from 'lucide-react';
import Image from 'next/image';
import { Asset } from '../types/asset.types';

interface AssetCardProps {
  asset: Asset;
  onEdit: (assetId: string) => void;
  onDelete: (assetId: string) => void;
}

const ASSET_ICONS = {
  character: User,
  location: MapPin,
  voice: Mic,
};

export function AssetCard({ asset, onEdit, onDelete }: AssetCardProps) {
  const Icon = ASSET_ICONS[asset.type];

  return (
    <Card className="group hover:shadow-lg transition-shadow">
      <CardContent className="p-4">
        {/* Thumbnail */}
        <div className="aspect-square bg-muted rounded-lg mb-3 overflow-hidden relative">
          {asset.referenceImageUrl ? (
            <Image
              src={asset.referenceImageUrl}
              alt={asset.name}
              fill
              className="object-cover"
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Icon className="h-12 w-12 text-muted-foreground" />
            </div>
          )}
        </div>

        {/* Name */}
        <h3 className="font-semibold text-sm line-clamp-2 mb-1">
          {asset.name}
        </h3>

        {/* Description */}
        {asset.description && (
          <p className="text-xs text-muted-foreground line-clamp-1">
            {asset.description}
          </p>
        )}
      </CardContent>

      <CardFooter className="p-4 pt-0 flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => onEdit(asset.id)}
        >
          <Edit className="h-4 w-4 mr-1" />
          Edit
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onDelete(asset.id)}
        >
          <Trash2 className="h-4 w-4" />
          <span className="sr-only">Delete</span>
        </Button>
      </CardFooter>
    </Card>
  );
}
```

### Asset Card Skeleton

**File**: `packages/features/assets/src/components/AssetCardSkeleton.tsx`

```typescript
'use client';

import { Card, CardContent, CardFooter } from '@kit/ui/card';
import { Skeleton } from '@kit/ui/skeleton';

export function AssetCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-4">
        <Skeleton className="aspect-square rounded-lg mb-3" />
        <Skeleton className="h-4 w-3/4 mb-2" />
        <Skeleton className="h-3 w-full" />
      </CardContent>
      <CardFooter className="p-4 pt-0 flex gap-2">
        <Skeleton className="h-8 flex-1" />
        <Skeleton className="h-8 w-8" />
      </CardFooter>
    </Card>
  );
}
```

### Empty State

**File**: `packages/features/assets/src/components/EmptyAssetState.tsx`

```typescript
'use client';

import { Button } from '@kit/ui/button';
import { Plus, User, MapPin, Mic } from 'lucide-react';

interface EmptyAssetStateProps {
  assetType: 'character' | 'location' | 'voice';
  onCreate: () => void;
}

const EMPTY_STATE_CONFIG = {
  character: {
    icon: User,
    title: 'No characters yet',
    description: 'Create your first character to bring your story to life.',
    cta: 'Create Character',
  },
  location: {
    icon: MapPin,
    title: 'No locations yet',
    description: 'Add locations where your story takes place.',
    cta: 'Create Location',
  },
  voice: {
    icon: Mic,
    title: 'No voice profiles yet',
    description: 'Add voice profiles for your characters.',
    cta: 'Create Voice Profile',
  },
};

export function EmptyAssetState({ assetType, onCreate }: EmptyAssetStateProps) {
  const config = EMPTY_STATE_CONFIG[assetType];
  const Icon = config.icon;

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="bg-muted rounded-full p-6 mb-4">
        <Icon className="h-12 w-12 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-2">{config.title}</h3>
      <p className="text-muted-foreground mb-6 max-w-sm">{config.description}</p>
      <Button onClick={onCreate}>
        <Plus className="mr-2 h-4 w-4" />
        {config.cta}
      </Button>
    </div>
  );
}
```

---

## File Changes

### New Files

1. **packages/features/assets/src/components/AssetGallery.tsx**
   - Main gallery component with tabs, search, grid

2. **packages/features/assets/src/components/AssetTabs.tsx**
   - Tab navigation component

3. **packages/features/assets/src/components/AssetSearchBar.tsx**
   - Debounced search input

4. **packages/features/assets/src/components/AssetGrid.tsx**
   - Responsive grid container

5. **packages/features/assets/src/components/AssetCard.tsx**
   - Individual asset card with actions

6. **packages/features/assets/src/components/AssetCardSkeleton.tsx**
   - Loading skeleton for cards

7. **packages/features/assets/src/components/EmptyAssetState.tsx**
   - Empty state with CTA

### Modified Files

None (new feature)

---

## Acceptance Criteria

### Functional

- [ ] Gallery displays three tabs: Characters, Locations, Voices
- [ ] Active tab persisted in URL query parameter
- [ ] Only active tab assets loaded (no unnecessary requests)
- [ ] Assets displayed in responsive grid (1-4 columns)
- [ ] Asset cards show thumbnail, name, description preview
- [ ] Asset cards have Edit and Delete buttons
- [ ] Search bar filters assets by name and description
- [ ] Search input debounced (300ms)
- [ ] Clear search button appears when query present
- [ ] Skeleton loading state displayed while fetching
- [ ] Empty state displayed when no assets
- [ ] Empty state CTA opens create modal/page
- [ ] Delete confirmation dialog before deletion
- [ ] Optimistic UI update on delete
- [ ] Error rollback on delete failure
- [ ] Toast notifications for success/error

### Non-Functional

- [ ] Renders 50 assets within 500ms
- [ ] Smooth tab transitions
- [ ] Hover effects on cards
- [ ] Keyboard navigation works (Tab, Enter, Space)
- [ ] Screen reader announces tabs and cards
- [ ] Focus visible on interactive elements
- [ ] Responsive on mobile, tablet, desktop
- [ ] TypeScript compiles without errors
- [ ] No ESLint warnings

---

## Test Plan

### Unit Tests

**File**: `packages/features/assets/src/components/__tests__/AssetGallery.test.tsx`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssetGallery } from '../AssetGallery';

vi.mock('@tanstack/react-query');

describe('AssetGallery', () => {
  it('should render tabs', () => {
    render(<AssetGallery projectId="project-1" />);
    expect(screen.getByText('Characters')).toBeInTheDocument();
    expect(screen.getByText('Locations')).toBeInTheDocument();
    expect(screen.getByText('Voices')).toBeInTheDocument();
  });

  it('should switch tabs', async () => {
    render(<AssetGallery projectId="project-1" />);
    const user = userEvent.setup();

    await user.click(screen.getByText('Locations'));
    expect(screen.getByText('Locations')).toHaveAttribute('aria-selected', 'true');
  });

  it('should display assets in grid', async () => {
    // Mock assets data
    render(<AssetGallery projectId="project-1" />);
    await waitFor(() => {
      expect(screen.getByText('Character 1')).toBeInTheDocument();
    });
  });

  it('should filter assets by search query', async () => {
    render(<AssetGallery projectId="project-1" />);
    const user = userEvent.setup();

    const searchInput = screen.getByPlaceholderText('Search assets...');
    await user.type(searchInput, 'hero');

    await waitFor(() => {
      expect(screen.getByText('Hero Character')).toBeInTheDocument();
      expect(screen.queryByText('Villain Character')).not.toBeInTheDocument();
    });
  });

  it('should show empty state when no assets', () => {
    // Mock empty assets
    render(<AssetGallery projectId="project-1" />);
    expect(screen.getByText('No characters yet')).toBeInTheDocument();
  });

  it('should show skeleton while loading', () => {
    // Mock loading state
    render(<AssetGallery projectId="project-1" />);
    expect(screen.getAllByTestId('skeleton')).toHaveLength(8);
  });
});
```

### Integration Tests

**File**: `apps/web/__tests__/integration/asset-gallery.test.tsx`

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssetGallery } from '@kit/assets/components/AssetGallery';

describe('Asset Gallery Integration', () => {
  it('should fetch and display assets', async () => {
    render(<AssetGallery projectId="test-project" />);

    await waitFor(() => {
      expect(screen.getByText('Test Character')).toBeInTheDocument();
    });
  });

  it('should delete asset with confirmation', async () => {
    render(<AssetGallery projectId="test-project" />);
    const user = userEvent.setup();

    const deleteButton = screen.getAllByLabelText('Delete')[0];
    await user.click(deleteButton);

    // Mock confirm dialog
    await waitFor(() => {
      expect(screen.queryByText('Test Character')).not.toBeInTheDocument();
    });
  });

  it('should persist tab in URL', async () => {
    render(<AssetGallery projectId="test-project" />);
    const user = userEvent.setup();

    await user.click(screen.getByText('Locations'));

    expect(window.location.search).toContain('tab=location');
  });
});
```

### Visual Testing

Use Playwright for visual regression:

```typescript
test('asset gallery renders correctly', async ({ page }) => {
  await page.goto('/projects/test-project/assets');
  await expect(page).toHaveScreenshot('asset-gallery.png');
});

test('asset card hover state', async ({ page }) => {
  await page.goto('/projects/test-project/assets');
  await page.hover('[data-testid="asset-card"]');
  await expect(page).toHaveScreenshot('asset-card-hover.png');
});
```

---

## Accessibility

### Keyboard Navigation

- Tab: Focus next interactive element
- Shift+Tab: Focus previous element
- Enter/Space: Activate button or tab
- Arrow keys: Navigate between tabs

### ARIA Attributes

```typescript
<Tabs role="tablist" aria-label="Asset types">
  <TabsTrigger
    role="tab"
    aria-selected={activeTab === 'character'}
    aria-controls="character-panel"
  >
    Characters
  </TabsTrigger>
</Tabs>

<Button aria-label="Delete character John Doe">
  <Trash2 />
</Button>

<Input
  aria-label="Search assets"
  aria-describedby="search-description"
/>
```

### Screen Reader Support

- Tab navigation announced correctly
- Asset count announced when tab changes
- Loading state announced
- Empty state announced
- Deletion success/error announced

---

## Performance Considerations

### Rendering Optimization

```typescript
// Memoize filtered assets
const filteredAssets = useMemo(() => {
  // Filtering logic
}, [data?.assets, searchQuery]);

// Lazy load images
<Image
  src={asset.referenceImageUrl}
  loading="lazy"
  placeholder="blur"
/>

// Virtual scrolling for large lists (future)
import { useVirtualizer } from '@tanstack/react-virtual';
```

### Caching Strategy

```typescript
// React Query cache configuration
const { data } = useQuery({
  queryKey: ['assets', projectId, activeTab],
  queryFn: fetchAssets,
  staleTime: 5 * 60 * 1000,      // 5 minutes
  cacheTime: 30 * 60 * 1000,     // 30 minutes
  refetchOnMount: false,
  refetchOnWindowFocus: false,
});
```

### Optimistic Updates

```typescript
onMutate: async (assetId) => {
  await queryClient.cancelQueries({ queryKey: ['assets', projectId, activeTab] });

  const previous = queryClient.getQueryData(['assets', projectId, activeTab]);

  // Update cache immediately
  queryClient.setQueryData(['assets', projectId, activeTab], (old: any) => ({
    ...old,
    assets: old.assets.filter((a: Asset) => a.id !== assetId),
  }));

  return { previous };
},
```

---

## Responsive Design

### Breakpoints

```css
/* Mobile: 1 column */
@media (max-width: 640px) {
  grid-template-columns: repeat(1, minmax(0, 1fr));
}

/* Tablet: 2 columns */
@media (min-width: 640px) and (max-width: 1024px) {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

/* Desktop: 3 columns */
@media (min-width: 1024px) and (max-width: 1280px) {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

/* Large desktop: 4 columns */
@media (min-width: 1280px) {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
```

---

## Future Enhancements

1. **Sorting Options**
   - Sort by name, date created, date modified
   - Ascending/descending toggle

2. **Bulk Actions**
   - Select multiple assets
   - Bulk delete, bulk export

3. **Grid/List View Toggle**
   - Switch between grid and list layouts
   - Persist preference in localStorage

4. **Infinite Scroll**
   - Load more assets as user scrolls
   - Replace "Load More" button

5. **Drag and Drop**
   - Reorder assets by dragging cards
   - Persist custom order

---

## References

- **FILM-201**: Asset CRUD actions
- **FILM-208**: Asset Library Page (uses this component)
- **Shadcn Tabs**: https://ui.shadcn.com/docs/components/tabs
- **React Query**: https://tanstack.com/query/latest/docs/react/overview
- **Constitution**: Section 2.3 (Component Pattern)
