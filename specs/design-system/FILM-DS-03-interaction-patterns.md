# FILM-DS-03: Interaction Patterns

## Metadata
- **Phase:** Design System
- **Priority:** P0 (Critical)
- **Effort:** M (4-8 hours)
- **Dependencies:** FILM-DS-01 (Component Inventory), FILM-DS-02 (Design Tokens)
- **Blocks:** FILM-410 (Shot Grid), FILM-601 (Timeline Editor)
- **Status:** ✅ Complete
- **Implemented:** 2025-12-07
- **PR:** #16

---

## Context

The Film Studio requires complex interaction patterns for drag-and-drop, keyboard navigation, and real-time updates. Standardizing these patterns ensures consistency and accessibility.

---

## Specification

### 1. Drag and Drop Patterns

#### Shot Grid Reordering

```typescript
// Pattern: Draggable grid items with sequence update

interface DragState {
  isDragging: boolean;
  draggedId: string | null;
  dropTargetId: string | null;
}

// Visual feedback during drag
const dragStyles = {
  dragging: 'opacity-50 scale-105 shadow-lg z-50',
  dropTarget: 'ring-2 ring-primary ring-offset-2',
  invalid: 'ring-2 ring-destructive',
};

// Drag handle affordance
<div className="cursor-grab active:cursor-grabbing" aria-label="Drag to reorder">
  <GripVertical className="h-4 w-4 text-muted-foreground" />
</div>
```

#### Timeline Clip Manipulation

```typescript
// Pattern: Horizontal drag with snapping

interface ClipDragState {
  clipId: string;
  originalStart: number;
  currentStart: number;
  isResizing: 'left' | 'right' | null;
}

// Snapping behavior
const SNAP_THRESHOLD_PX = 10;
const SNAP_POINTS = ['clipEdges', 'playhead', 'gridLines'];

// Resize handles on clips
<div
  className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/20"
  aria-label="Resize clip start"
/>
<div
  className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/20"
  aria-label="Resize clip end"
/>
```

#### Asset Assignment

```typescript
// Pattern: Drag asset to shot for assignment

interface AssetDropZone {
  accepts: AssetType[];
  onDrop: (assetId: string) => void;
}

// Drop zone states
const dropZoneStyles = {
  idle: 'border-dashed border-2 border-muted',
  active: 'border-primary bg-primary/5',
  invalid: 'border-destructive bg-destructive/5',
  hasContent: 'border-solid border-border',
};
```

### 2. Keyboard Navigation

#### Shot Grid Navigation

| Keys | Action | Context |
|------|--------|---------|
| `←` `→` `↑` `↓` | Navigate shots | Grid focused |
| `Space` | Play/pause preview | Shot selected |
| `Enter` | Open shot editor | Shot selected |
| `Delete` / `Backspace` | Remove shot | Shot selected |
| `Shift+Click` | Multi-select range | Grid focused |
| `Cmd/Ctrl+A` | Select all | Grid focused |
| `Escape` | Deselect all | Any selection |

```typescript
// Implementation pattern
function useShotGridKeyboard(shots: Shot[], selectedIds: Set<string>) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      moveSelection('next');
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      moveSelection('prev');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveSelection('down', gridColumns);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveSelection('up', gridColumns);
    } else if (e.key === ' ') {
      e.preventDefault();
      togglePreview();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openEditor();
    }
  }, [shots, selectedIds]);

  return { handleKeyDown };
}
```

#### Timeline Navigation

| Keys | Action | Context |
|------|--------|---------|
| `Space` | Play/pause | Timeline focused |
| `←` `→` | Scrub playhead (1 frame) | Timeline focused |
| `Shift+←` `Shift+→` | Scrub playhead (1 second) | Timeline focused |
| `[` | Set in-point | Playback |
| `]` | Set out-point | Playback |
| `Home` | Go to start | Timeline focused |
| `End` | Go to end | Timeline focused |
| `+` `-` | Zoom in/out | Timeline focused |
| `Cmd/Ctrl+Z` | Undo | Global |
| `Cmd/Ctrl+Shift+Z` | Redo | Global |

### 3. Loading States

#### Progressive Loading Pattern

```typescript
// 1. Skeleton while data loads
<ShotGridSkeleton count={12} />

// 2. Placeholder while generating
<ShotCard status="generating" progress={45}>
  <ShotCardPlaceholder />
  <ProgressRing progress={45} />
  <span className="sr-only">Generating video, 45% complete</span>
</ShotCard>

// 3. Optimistic update on action
const { mutate } = useMutation({
  mutationFn: generateVideo,
  onMutate: async (shotId) => {
    // Optimistically update to "generating"
    queryClient.setQueryData(['shots', episodeId], (old) =>
      old.map(s => s.id === shotId ? { ...s, status: 'generating' } : s)
    );
  },
});
```

#### Skeleton Components

```typescript
// Shot grid skeleton
function ShotGridSkeleton({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="aspect-video rounded-lg" />
      ))}
    </div>
  );
}

// Episode card skeleton
function EpisodeCardSkeleton() {
  return (
    <Card>
      <Skeleton className="aspect-video" />
      <CardContent className="space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </CardContent>
    </Card>
  );
}
```

### 4. Empty States

```typescript
interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-1">{title}</h3>
      <p className="text-muted-foreground mb-4 max-w-sm">{description}</p>
      {action && (
        <Button onClick={action.onClick}>{action.label}</Button>
      )}
    </div>
  );
}

// Usage examples
<EmptyState
  icon={Film}
  title="No episodes yet"
  description="Create your first episode to start generating content"
  action={{ label: 'Create Episode', onClick: handleCreate }}
/>

<EmptyState
  icon={Users}
  title="No characters defined"
  description="Add characters to maintain visual consistency across shots"
  action={{ label: 'Add Character', onClick: handleAddCharacter }}
/>
```

### 5. Error States

```typescript
// Generation failure with retry
<ShotCard status="failed">
  <Alert variant="destructive" className="absolute inset-0 m-2">
    <XCircle className="h-4 w-4" />
    <AlertTitle>Generation Failed</AlertTitle>
    <AlertDescription>
      {error.message}
      {error.retryable && (
        <Button variant="outline" size="sm" onClick={retry}>
          Retry
        </Button>
      )}
    </AlertDescription>
  </Alert>
</ShotCard>

// Provider unavailable
<Alert variant="warning">
  <AlertTriangle className="h-4 w-4" />
  <AlertTitle>Provider Unavailable</AlertTitle>
  <AlertDescription>
    Kling API is experiencing issues. Your job has been queued and will
    retry automatically when service is restored.
  </AlertDescription>
</Alert>

// Cost limit reached
<Alert variant="destructive">
  <CreditCard className="h-4 w-4" />
  <AlertTitle>Credit Limit Reached</AlertTitle>
  <AlertDescription>
    You've used all your generation credits this month.
    <Button variant="link" asChild>
      <Link href="/settings/billing">Upgrade Plan</Link>
    </Button>
  </AlertDescription>
</Alert>
```

### 6. Real-Time Updates

```typescript
// Pattern: Optimistic UI with server reconciliation

function useShotUpdates(episodeId: string) {
  const queryClient = useQueryClient();

  // Subscribe to real-time updates
  useEffect(() => {
    const channel = supabase
      .channel(`shots:${episodeId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'shots',
        filter: `episode_id=eq.${episodeId}`,
      }, (payload) => {
        queryClient.setQueryData(['shots', episodeId], (old: Shot[]) => {
          if (payload.eventType === 'UPDATE') {
            return old.map(s => s.id === payload.new.id ? payload.new : s);
          }
          return old;
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [episodeId, queryClient]);
}
```

### File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/film-studio/src/lib/interaction-patterns.ts` |
| CREATE | `packages/features/film-studio/src/hooks/use-keyboard-navigation.ts` |
| CREATE | `packages/features/film-studio/src/hooks/use-drag-drop.ts` |
| CREATE | `packages/features/film-studio/src/hooks/index.ts` |
| CREATE | `packages/features/film-studio/__tests__/interaction-patterns.test.ts` |
| UPDATE | `packages/features/film-studio/src/lib/index.ts` |
| UPDATE | `packages/features/film-studio/package.json` |

---

## Acceptance Criteria

- [x] Shot grid supports keyboard navigation
- [x] Timeline supports keyboard shortcuts for playback
- [x] Drag and drop has clear visual feedback
- [x] Loading states use skeletons (not spinners for content)
- [x] Empty states include actionable next steps
- [x] Error states include recovery options when possible
- [x] Real-time updates don't cause layout shift

---

## Accessibility Requirements

- All keyboard shortcuts have visible hints (via Tooltip)
- Focus is managed during drag operations
- Screen readers announce status changes via `aria-live`
- Drag handles have appropriate ARIA labels
- Keyboard-only users can complete all interactions

---

## Open Questions

- [ ] Should we implement undo/redo for shot reordering? (post-MVP)
- [ ] Should timeline support touch gestures for mobile? (post-MVP)
