# FILM-312: Episode Workspace Page

**Status**: ✅ DONE
**Phase**: 3
**Priority**: P0
**Effort**: L (5-7 days)
**Dependencies**: FILM-308 (story-studio)
**Blocks**: None

---

## Context

The Episode Workspace is the main page for episode content creation and management, providing a tabbed interface that integrates Story Studio, Visual Studio (Phase 4), Audio Studio (Phase 5), and Edit Suite (Phase 6). This page serves as the central hub for all episode-related workflows.

The page is accessible at `/home/[account]/studio/[projectId]/episodes/[episodeId]` and provides navigation between different production stages, episode metadata display, and quick actions for common tasks.

---

## Requirements

### Functional Requirements

1. **Page Layout**
   - Header with episode title and status badge
   - Breadcrumb navigation (Project > Episodes > Episode Title)
   - Main tabbed interface (Story, Visuals, Audio, Edit)
   - Sidebar with episode metadata (future)
   - Responsive layout for mobile and desktop

2. **Tab Navigation**
   - Story Studio tab (Phase 3)
   - Visual Studio tab (Phase 4 - video generation)
   - Audio Studio tab (Phase 5 - voice/music)
   - Edit Suite tab (Phase 6 - timeline editing)
   - Tabs unlock based on episode status
   - Active tab persists in URL

3. **Episode Header**
   - Episode title (editable inline)
   - Status badge with workflow state
   - Last updated timestamp
   - Quick actions dropdown (duplicate, delete, export)
   - Version indicator

4. **Data Loading**
   - Fetch episode on mount
   - Real-time updates via Supabase subscription (future)
   - Loading states for all tabs
   - Error boundaries for failed loads

---

## Interface

### Page Component

```typescript
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@kit/ui/tabs';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Skeleton } from '@kit/ui/skeleton';
import { MoreVertical, ArrowLeft } from 'lucide-react';
import { getEpisodeWithShotsAction } from '@kit/episodes/server';
import { StoryStudio } from '@kit/episodes/components';

interface PageProps {
  params: {
    account: string;
    projectId: string;
    episodeId: string;
  };
  searchParams: {
    tab?: string;
  };
}

export default async function EpisodeWorkspacePage({
  params,
  searchParams,
}: PageProps) {
  const episode = await getEpisodeWithShotsAction({
    episodeId: params.episodeId,
  });

  if (!episode) {
    notFound();
  }

  const defaultTab = searchParams.tab ?? 'story';

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm">
        <Button variant="ghost" size="sm" asChild>
          <a href={`/home/${params.account}/studio/${params.projectId}`}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Project
          </a>
        </Button>
        <span className="text-muted-foreground">/</span>
        <Button variant="ghost" size="sm" asChild>
          <a href={`/home/${params.account}/studio/${params.projectId}/episodes`}>
            Episodes
          </a>
        </Button>
        <span className="text-muted-foreground">/</span>
        <span className="font-medium">{episode.title}</span>
      </nav>

      {/* Episode Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">{episode.title}</h1>
            <StatusBadge status={episode.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            Episode {episode.number}
            {episode.season && ` • Season ${episode.season.number}`}
          </p>
          <p className="text-xs text-muted-foreground">
            Last updated: {new Date(episode.updatedAt).toLocaleString()}
          </p>
        </div>

        <QuickActionsMenu
          episodeId={episode.id}
          projectId={params.projectId}
        />
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue={defaultTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="story">
            Story Studio
          </TabsTrigger>
          <TabsTrigger
            value="visuals"
            disabled={episode.status === 'draft'}
          >
            Visual Studio
          </TabsTrigger>
          <TabsTrigger
            value="audio"
            disabled={!episode.shotList}
          >
            Audio Studio
          </TabsTrigger>
          <TabsTrigger
            value="edit"
            disabled={episode.status !== 'editing' && episode.status !== 'ready'}
          >
            Edit Suite
          </TabsTrigger>
        </TabsList>

        <TabsContent value="story" className="space-y-4">
          <Suspense fallback={<StoryStudioSkeleton />}>
            <StoryStudio episodeId={episode.id} />
          </Suspense>
        </TabsContent>

        <TabsContent value="visuals">
          <div className="text-center py-12 text-muted-foreground">
            Visual Studio (Phase 4 - Coming Soon)
          </div>
        </TabsContent>

        <TabsContent value="audio">
          <div className="text-center py-12 text-muted-foreground">
            Audio Studio (Phase 5 - Coming Soon)
          </div>
        </TabsContent>

        <TabsContent value="edit">
          <div className="text-center py-12 text-muted-foreground">
            Edit Suite (Phase 6 - Coming Soon)
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    draft: 'bg-gray-500',
    story: 'bg-blue-500',
    storyboard: 'bg-purple-500',
    generating: 'bg-yellow-500',
    editing: 'bg-orange-500',
    ready: 'bg-green-500',
    published: 'bg-emerald-500',
  };

  return (
    <Badge className={variants[status] ?? 'bg-gray-500'}>
      {status}
    </Badge>
  );
}

function QuickActionsMenu({ episodeId, projectId }: {
  episodeId: string;
  projectId: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon">
          <MoreVertical className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem>
          Duplicate Episode
        </DropdownMenuItem>
        <DropdownMenuItem>
          Export Screenplay
        </DropdownMenuItem>
        <DropdownMenuItem>
          View Analytics
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive">
          Delete Episode
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StoryStudioSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

// Generate metadata for SEO
export async function generateMetadata({ params }: PageProps) {
  const episode = await getEpisodeWithShotsAction({
    episodeId: params.episodeId,
  });

  if (!episode) {
    return {
      title: 'Episode Not Found',
    };
  }

  return {
    title: `${episode.title} - Episode Workspace`,
    description: episode.description ?? 'Edit and manage your episode',
  };
}
```

---

## File Changes

### New Files

1. **apps/web/app/home/[account]/studio/[projectId]/episodes/[episodeId]/page.tsx** (CREATE THIS)
2. **apps/web/app/home/[account]/studio/[projectId]/episodes/[episodeId]/layout.tsx** (CREATE THIS - optional wrapper)

---

## Acceptance Criteria

### Functional

- [x] Page loads episode data on mount
- [x] Breadcrumb navigation works correctly
- [x] Episode title displays with status badge
- [x] Four tabs display (Story, Visuals, Audio, Edit)
- [x] Story Studio tab is fully functional
- [x] Other tabs show "Coming Soon" placeholders
- [x] Tabs unlock based on episode status
- [x] Active tab persists in URL query params
- [x] Quick actions menu displays options
- [x] Responsive layout on mobile and desktop
- [x] Loading states display appropriately
- [x] Error handling shows user-friendly messages
- [x] 404 page shown for non-existent episodes

### Non-Functional

- [x] Page loads within 1 second
- [x] Smooth transitions between tabs
- [x] TypeScript compiles without errors
- [x] No ESLint warnings
- [x] Metadata generated for SEO
- [ ] Accessibility (keyboard navigation, ARIA labels) - inherited from base components

---

## Test Plan

### Unit Tests

**File**: `apps/web/app/home/[account]/studio/[projectId]/episodes/[episodeId]/__tests__/page.test.tsx`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import EpisodeWorkspacePage from '../page';

vi.mock('@kit/episodes/server');

describe('EpisodeWorkspacePage', () => {
  it('should render episode title', async () => {
    const Page = await EpisodeWorkspacePage({
      params: {
        account: 'test-account',
        projectId: 'test-project',
        episodeId: 'test-episode',
      },
      searchParams: {},
    });

    render(Page);
    expect(screen.getByText('Test Episode')).toBeInTheDocument();
  });

  it('should show 404 for non-existent episode', async () => {
    // Test implementation
  });

  it('should unlock tabs based on status', async () => {
    // Test implementation
  });
});
```

### Integration Tests

```typescript
describe('Episode Workspace Integration', () => {
  it('should complete full story creation workflow', async () => {
    // 1. Navigate to episode workspace
    // 2. Generate story ideas
    // 3. Generate full story
    // 4. Convert to screenplay
    // 5. Generate shot list
    // 6. Verify all tabs functional
  });

  it('should persist tab state in URL', async () => {
    // Test URL query param persistence
  });
});
```

### Manual Testing

1. **Page Load**
   - Navigate to episode workspace
   - Verify episode title and status display
   - Check breadcrumb navigation works

2. **Tab Navigation**
   - Click each tab
   - Verify URL updates with ?tab=X
   - Verify locked tabs are disabled

3. **Story Studio Integration**
   - Complete full story pipeline
   - Verify all steps work
   - Check state persists between tabs

4. **Responsive Design**
   - Test on mobile viewport
   - Verify tabs collapse appropriately
   - Check sidebar behavior

5. **Error Handling**
   - Test with invalid episode ID
   - Verify 404 page shows
   - Test network errors

---

## Security Considerations

### Authorization

- RLS policies enforce episode access
- Server actions validate user permissions
- Cannot access episodes from inaccessible projects

### Input Validation

- Episode ID validated as UUID
- Account and project ID validated
- Tab parameter validated against enum

### Data Privacy

- Episode data only visible to project members
- No sensitive data in URL params
- Session-based authentication required

---

## Performance Considerations

### Initial Load

- Server-side rendering for fast first paint
- Episode data fetched in parallel with page render
- Suspense boundaries prevent layout shift

### Tab Switching

- Client-side tab switching (instant)
- Tab content lazy-loaded
- Cache tab content between switches

### Real-time Updates (Future)

```typescript
// Supabase subscription for real-time updates
useEffect(() => {
  const channel = supabase
    .channel(`episode:${episodeId}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'episodes',
      filter: `id=eq.${episodeId}`,
    }, (payload) => {
      queryClient.setQueryData(['episode', episodeId], payload.new);
    })
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, [episodeId]);
```

---

## Future Enhancements

1. **Collaboration Features**
   - Show active users editing episode
   - Real-time cursor positions
   - Comment threads on content

2. **Version History**
   - View previous story versions
   - Restore from history
   - Compare versions side-by-side

3. **Templates**
   - Save episode as template
   - Load from template
   - Share templates with team

4. **Keyboard Shortcuts**
   - Ctrl+1/2/3/4 for tab switching
   - Ctrl+S to save draft
   - Ctrl+G to generate

5. **Export Options**
   - Export screenplay as PDF
   - Export shot list as CSV
   - Export story as Markdown

---

## References

- **FILM-308**: Story Studio component
- **FILM-301**: Episode CRUD actions
- **Next.js Pages**: https://nextjs.org/docs/app/building-your-application/routing/pages-and-layouts
- **Next.js Metadata**: https://nextjs.org/docs/app/building-your-application/optimizing/metadata
- **Constitution**: Section 2.3 (Component Pattern)
- **Constitution**: Section 8 (Accessibility)
