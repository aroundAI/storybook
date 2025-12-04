# FILM-DS-05: Responsive Strategy

## Metadata
- **Phase:** Design System
- **Priority:** P1 (High)
- **Effort:** M (4-8 hours)
- **Dependencies:** FILM-DS-01 through FILM-DS-04
- **Blocks:** All page implementations

---

## Context

The Film Studio must work across devices from mobile phones to ultra-wide monitors. This spec defines responsive breakpoints, layout adaptations, and mobile-specific patterns.

---

## Specification

### 1. Breakpoint System

Using Tailwind's default breakpoints:

| Breakpoint | Min Width | Target Devices |
|------------|-----------|----------------|
| `sm` | 640px | Large phones (landscape) |
| `md` | 768px | Tablets (portrait) |
| `lg` | 1024px | Tablets (landscape), small laptops |
| `xl` | 1280px | Laptops, desktops |
| `2xl` | 1536px | Large monitors, ultra-wide |

### 2. Layout Adaptations

#### Desktop Layout (≥1280px)

```
┌──────────────────────────────────────────────────────────────────┐
│ Header                                                           │
├──────────┬───────────────────────────────────────────────────────┤
│          │                                                       │
│ Sidebar  │  Main Content Area                                   │
│ (240px)  │                                                       │
│          │  ┌─────────────────────────────────────────────────┐ │
│          │  │ Workspace (Tabs)                                │ │
│          │  │                                                  │ │
│          │  │  Story | Visual | Audio | Edit | Publish        │ │
│          │  │                                                  │ │
│          │  └─────────────────────────────────────────────────┘ │
│          │                                                       │
├──────────┴───────────────────────────────────────────────────────┤
│ Queue Panel (slide-over from right, optional)                    │
└──────────────────────────────────────────────────────────────────┘
```

#### Tablet Layout (768px - 1279px)

```
┌──────────────────────────────────────────────────────────────────┐
│ Header + Hamburger Menu                                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Main Content Area (full width)                                  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Tabs (stacked or scrollable)                               │ │
│  │                                                             │ │
│  │  Story → Visual → Audio → Edit → Publish                   │ │
│  │                                                             │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│ Bottom Action Bar (sticky)                                       │
└──────────────────────────────────────────────────────────────────┘

Sidebar: Collapsible sheet (hamburger trigger)
```

#### Mobile Layout (<768px)

```
┌─────────────────────────────────┐
│ Header (compact)                │
├─────────────────────────────────┤
│                                 │
│  Content (single column)        │
│                                 │
│  ┌───────────────────────────┐ │
│  │ Card                      │ │
│  └───────────────────────────┘ │
│  ┌───────────────────────────┐ │
│  │ Card                      │ │
│  └───────────────────────────┘ │
│                                 │
├─────────────────────────────────┤
│ ┌─────┬─────┬─────┬─────┬─────┐│
│ │Story│Visua│Audio│ Edit│Publi││
│ └─────┴─────┴─────┴─────┴─────┘│
│ Bottom Navigation               │
└─────────────────────────────────┘

All modals: Full-screen sheets
Timeline: Simplified view
```

### 3. Component-Specific Adaptations

#### Shot Grid

```typescript
// Responsive grid columns
<div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
  {shots.map(shot => <ShotCard key={shot.id} shot={shot} />)}
</div>

// Mobile: Swipe gestures for navigation
function useMobileShotNavigation() {
  // Implement swipe left/right for prev/next shot
}
```

#### Timeline Editor

| Breakpoint | Adaptation |
|------------|------------|
| Desktop | Full multi-track timeline with zoom controls |
| Tablet | Simplified view, pinch-to-zoom |
| Mobile | Single track view, swipe to switch tracks |

```typescript
// Timeline responsive behavior
function TimelineEditor({ tracks }: Props) {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const isTablet = useMediaQuery('(max-width: 1024px)');

  if (isMobile) {
    return <MobileTimeline tracks={tracks} />;
  }

  if (isTablet) {
    return <TabletTimeline tracks={tracks} />;
  }

  return <DesktopTimeline tracks={tracks} />;
}
```

#### Asset Picker

| Breakpoint | Implementation |
|------------|----------------|
| Desktop | Dialog with sidebar filters |
| Tablet | Sheet from right, 50% width |
| Mobile | Full-screen sheet with bottom filters |

```typescript
function AssetPicker({ onSelect }: Props) {
  const isMobile = useMediaQuery('(max-width: 768px)');

  if (isMobile) {
    return (
      <Sheet>
        <SheetContent side="bottom" className="h-[90vh]">
          <AssetPickerContent onSelect={onSelect} />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog>
      <DialogContent className="max-w-4xl">
        <AssetPickerContent onSelect={onSelect} />
      </DialogContent>
    </Dialog>
  );
}
```

#### Navigation

```typescript
// Sidebar responsive behavior
function StudioSidebar() {
  const isDesktop = useMediaQuery('(min-width: 1280px)');
  const [isOpen, setIsOpen] = useState(false);

  if (isDesktop) {
    return (
      <aside className="w-60 border-r bg-background">
        <SidebarContent />
      </aside>
    );
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setIsOpen(true)}
        className="lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </Button>
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent side="left" className="w-60 p-0">
          <SidebarContent />
        </SheetContent>
      </Sheet>
    </>
  );
}
```

### 4. Touch Interactions

#### Mobile-Specific Gestures

| Gesture | Action | Component |
|---------|--------|-----------|
| Swipe left/right | Navigate shots | Shot Grid |
| Pinch | Zoom timeline | Timeline |
| Long press | Open context menu | Cards |
| Pull down | Refresh | Lists |
| Swipe up | Expand preview | Video Player |

```typescript
// Touch gesture hook
function useTouchGestures(ref: RefObject<HTMLElement>) {
  const [gesture, setGesture] = useState<Gesture | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    let startX = 0;
    let startY = 0;

    const handleTouchStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;
      const deltaX = endX - startX;
      const deltaY = endY - startY;

      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
        setGesture(deltaX > 0 ? 'swipe-right' : 'swipe-left');
      }
    };

    element.addEventListener('touchstart', handleTouchStart);
    element.addEventListener('touchend', handleTouchEnd);

    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchend', handleTouchEnd);
    };
  }, [ref]);

  return gesture;
}
```

### 5. Typography Scaling

```typescript
// Responsive text sizes
const textScale = {
  h1: 'text-2xl sm:text-3xl lg:text-4xl',
  h2: 'text-xl sm:text-2xl lg:text-3xl',
  h3: 'text-lg sm:text-xl lg:text-2xl',
  body: 'text-sm sm:text-base',
  small: 'text-xs sm:text-sm',
};

// Usage
<h1 className={textScale.h1}>Episode Title</h1>
```

### 6. Container Queries (Future)

When container queries have broader support:

```css
/* Component adapts to container, not viewport */
@container (min-width: 400px) {
  .shot-card {
    aspect-ratio: 16/9;
  }
}

@container (max-width: 399px) {
  .shot-card {
    aspect-ratio: 1/1;
  }
}
```

### 7. Testing Matrix

| Device | Breakpoint | Primary Testing |
|--------|------------|-----------------|
| iPhone 14 | 390px | Mobile layouts |
| iPad Mini | 768px | Tablet portrait |
| iPad Pro | 1024px | Tablet landscape |
| MacBook Air | 1280px | Laptop |
| iMac | 1920px | Desktop |
| Ultra-wide | 2560px | Large monitors |

### File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/film-studio/src/hooks/use-media-query.ts` |
| CREATE | `packages/features/film-studio/src/hooks/use-touch-gestures.ts` |
| CREATE | `packages/features/film-studio/src/components/layout/responsive-layout.tsx` |
| CREATE | `packages/features/film-studio/src/components/layout/mobile-nav.tsx` |

---

## Acceptance Criteria

- [ ] All pages render correctly at all breakpoints
- [ ] Sidebar collapses to sheet on tablet/mobile
- [ ] Bottom navigation appears on mobile
- [ ] Touch gestures work on mobile devices
- [ ] Timeline has simplified mobile view
- [ ] Modals become full-screen sheets on mobile
- [ ] Typography scales appropriately
- [ ] No horizontal overflow at any breakpoint

---

## Performance Considerations

- Use `useMediaQuery` hook sparingly (causes re-render)
- Prefer CSS-based responsiveness when possible
- Lazy load mobile-specific components
- Reduce image quality on mobile networks

---

## Testing Approach

1. **Chrome DevTools**: Device emulation for quick testing
2. **BrowserStack**: Real device testing
3. **Playwright**: Automated responsive tests
4. **Manual**: Physical device testing for touch

---

## Open Questions

- [ ] Should we support offline mode for mobile? (post-MVP)
- [ ] Should we have a dedicated mobile app? (post-MVP)
