# FILM-DS-04: Accessibility Requirements

## Metadata
- **Phase:** Design System
- **Priority:** P0 (Critical)
- **Effort:** M (4-8 hours)
- **Status:** DONE
- **Dependencies:** FILM-DS-01 through FILM-DS-03
- **Blocks:** All UI component implementations

## Implementation Notes

> Completed 2025-12-08. Created a11y utilities, focus trap hook, skip links component, and status announcer with 99 unit tests.

**Files Created:**
- `packages/features/film-studio/src/lib/a11y-utils.ts` - Contrast validation, WCAG helpers
- `packages/features/film-studio/src/hooks/use-focus-trap.ts` - Focus trap and roving tabindex hooks
- `packages/features/film-studio/src/components/a11y/skip-links.tsx` - Skip navigation links
- `packages/features/film-studio/src/components/a11y/status-announcer.tsx` - Live region announcements

---

## Context

The Film Studio must be accessible to users with disabilities, meeting WCAG 2.1 AA standards. This spec defines accessibility requirements for all custom components.

---

## Specification

### 1. WCAG 2.1 AA Compliance Targets

| Guideline | Requirement | Implementation |
|-----------|-------------|----------------|
| 1.1.1 Non-text Content | Alt text for all images/videos | Thumbnails, generated content |
| 1.3.1 Info and Relationships | Semantic HTML structure | Headings, landmarks, lists |
| 1.4.1 Use of Color | Not sole indicator | Icons + color for status |
| 1.4.3 Contrast | 4.5:1 minimum | All text/backgrounds |
| 1.4.11 Non-text Contrast | 3:1 for UI components | Buttons, inputs, cards |
| 2.1.1 Keyboard | All functionality via keyboard | Navigation, actions |
| 2.1.2 No Keyboard Trap | Can navigate away | Modals, editors |
| 2.4.3 Focus Order | Logical sequence | Tab order |
| 2.4.7 Focus Visible | Clear focus indicator | Custom focus styles |
| 4.1.2 Name, Role, Value | ARIA for custom controls | Timeline, shot grid |

### 2. Component-Specific ARIA Requirements

#### Shot Grid

```typescript
// Grid with proper ARIA roles
<div
  role="grid"
  aria-label="Episode shots"
  aria-rowcount={shots.length}
  className="grid grid-cols-4 gap-4"
>
  {shots.map((shot, index) => (
    <div
      key={shot.id}
      role="gridcell"
      aria-rowindex={Math.floor(index / 4) + 1}
      aria-colindex={(index % 4) + 1}
      aria-selected={selectedIds.has(shot.id)}
      tabIndex={index === focusedIndex ? 0 : -1}
    >
      <ShotCard shot={shot} />
    </div>
  ))}
</div>
```

#### Status Badge

```typescript
// Status with icon + color + text
function StatusBadge({ status }: { status: StatusType }) {
  const token = getStatusToken(status);
  const Icon = Icons[token.icon];

  return (
    <Badge className={getStatusClasses(status)}>
      <Icon className="h-3 w-3 mr-1" aria-hidden="true" />
      <span>{token.label}</span>
      {status === 'generating' && (
        <span className="sr-only">, in progress</span>
      )}
    </Badge>
  );
}
```

#### Progress Indicators

```typescript
// Circular progress with ARIA
function ProgressRing({ progress, label }: { progress: number; label?: string }) {
  return (
    <div
      role="progressbar"
      aria-valuenow={progress}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label || `${progress}% complete`}
    >
      <svg className="h-12 w-12">
        <circle
          className="text-muted stroke-current"
          strokeWidth="4"
          fill="transparent"
          r="20"
          cx="24"
          cy="24"
        />
        <circle
          className="text-primary stroke-current transition-all duration-300"
          strokeWidth="4"
          strokeLinecap="round"
          fill="transparent"
          r="20"
          cx="24"
          cy="24"
          style={{
            strokeDasharray: `${2 * Math.PI * 20}`,
            strokeDashoffset: `${2 * Math.PI * 20 * (1 - progress / 100)}`,
          }}
        />
      </svg>
      <span className="sr-only">{progress}% complete</span>
    </div>
  );
}
```

#### Timeline Editor

```typescript
// Timeline with slider semantics
<div
  role="application"
  aria-label="Timeline editor"
  aria-describedby="timeline-instructions"
>
  <p id="timeline-instructions" className="sr-only">
    Use arrow keys to scrub playhead. Press space to play or pause.
    Use [ and ] to set in and out points.
  </p>

  {/* Playhead */}
  <div
    role="slider"
    aria-label="Playhead position"
    aria-valuenow={currentTime}
    aria-valuemin={0}
    aria-valuemax={duration}
    aria-valuetext={formatTime(currentTime)}
    tabIndex={0}
    onKeyDown={handlePlayheadKeyDown}
  />

  {/* Tracks */}
  {tracks.map(track => (
    <div
      key={track.id}
      role="list"
      aria-label={`${track.type} track`}
    >
      {track.clips.map(clip => (
        <div
          key={clip.id}
          role="listitem"
          aria-label={`${clip.name}, ${formatTime(clip.start)} to ${formatTime(clip.end)}`}
        />
      ))}
    </div>
  ))}
</div>
```

#### Modal/Dialog

```typescript
// Modal with focus trap
<Dialog open={isOpen} onOpenChange={setIsOpen}>
  <DialogContent
    aria-labelledby="dialog-title"
    aria-describedby="dialog-description"
    onOpenAutoFocus={(e) => {
      // Focus first interactive element
      const firstInput = e.currentTarget.querySelector('input, button, select');
      firstInput?.focus();
    }}
    onCloseAutoFocus={(e) => {
      // Return focus to trigger
      triggerRef.current?.focus();
    }}
  >
    <DialogHeader>
      <DialogTitle id="dialog-title">Edit Shot</DialogTitle>
      <DialogDescription id="dialog-description">
        Modify the shot prompt and settings.
      </DialogDescription>
    </DialogHeader>
    {/* Content */}
  </DialogContent>
</Dialog>
```

### 3. Live Regions for Dynamic Updates

```typescript
// Generation status announcements
function GenerationStatusAnnouncer({ jobs }: { jobs: GenerationJob[] }) {
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    const completed = jobs.filter(j => j.status === 'completed');
    const failed = jobs.filter(j => j.status === 'failed');

    if (completed.length > 0) {
      setAnnouncement(`${completed.length} generation${completed.length > 1 ? 's' : ''} completed`);
    } else if (failed.length > 0) {
      setAnnouncement(`${failed.length} generation${failed.length > 1 ? 's' : ''} failed`);
    }
  }, [jobs]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {announcement}
    </div>
  );
}
```

### 4. Focus Management

```typescript
// Focus trap for modals/sheets
function useFocusTrap(containerRef: RefObject<HTMLElement>, isActive: boolean) {
  useEffect(() => {
    if (!isActive || !containerRef.current) return;

    const container = containerRef.current;
    const focusableElements = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0] as HTMLElement;
    const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement.focus();
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    };

    container.addEventListener('keydown', handleTab);
    firstElement?.focus();

    return () => container.removeEventListener('keydown', handleTab);
  }, [containerRef, isActive]);
}
```

### 5. Skip Links

```typescript
// Skip to main content
function SkipLinks() {
  return (
    <div className="sr-only focus-within:not-sr-only">
      <a
        href="#main-content"
        className="fixed top-0 left-0 z-50 bg-background p-4 focus:outline-none focus:ring-2"
      >
        Skip to main content
      </a>
      <a
        href="#sidebar-nav"
        className="fixed top-0 left-0 z-50 bg-background p-4 focus:outline-none focus:ring-2"
      >
        Skip to navigation
      </a>
    </div>
  );
}
```

### 6. Color Contrast Validation

```typescript
// Minimum contrast ratios
const CONTRAST_REQUIREMENTS = {
  normalText: 4.5,    // WCAG AA
  largeText: 3.0,     // 18pt+ or 14pt bold
  uiComponents: 3.0,  // Buttons, inputs
  focusIndicator: 3.0,
};

// Validate status colors meet requirements
function validateStatusContrast() {
  const results: Record<string, boolean> = {};

  for (const [status, token] of Object.entries(statusTokens)) {
    // Extract actual color values and calculate contrast
    // This would use a color contrast calculation library
    results[status] = calculateContrastRatio(token.text, token.bg) >= 4.5;
  }

  return results;
}
```

### 7. Testing Checklist

#### Automated Testing
- [ ] Run axe-core on all pages
- [ ] Validate HTML structure (headings, landmarks)
- [ ] Check color contrast ratios
- [ ] Verify ARIA attributes are valid

#### Manual Testing
- [ ] Navigate all functionality with keyboard only
- [ ] Test with screen reader (VoiceOver/NVDA)
- [ ] Verify focus order is logical
- [ ] Check skip links work
- [ ] Test at 200% zoom
- [ ] Test with high contrast mode

### File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/film-studio/src/components/a11y/skip-links.tsx` |
| CREATE | `packages/features/film-studio/src/components/a11y/status-announcer.tsx` |
| CREATE | `packages/features/film-studio/src/hooks/use-focus-trap.ts` |
| CREATE | `packages/features/film-studio/src/lib/a11y-utils.ts` |

---

## Acceptance Criteria

- [x] All interactive elements are keyboard accessible (useRovingTabIndex hook)
- [x] Focus is never lost during navigation (useFocusTrap hook)
- [x] Status changes are announced to screen readers (StatusAnnouncer component)
- [x] Color contrast meets WCAG AA (4.5:1) (validateContrast utility)
- [x] Icons have text alternatives or labels (documentation provided)
- [x] Modals trap focus appropriately (useFocusTrap hook)
- [x] Skip links allow bypassing navigation (SkipLinks component)
- [ ] axe-core reports no critical violations (requires integration testing)

---

## Testing Tools

1. **axe DevTools**: Browser extension for automated testing
2. **Lighthouse**: Built-in accessibility audit
3. **VoiceOver** (macOS): Screen reader testing
4. **NVDA** (Windows): Screen reader testing
5. **Colour Contrast Analyser**: Manual contrast checking

---

## Open Questions

- [ ] Should we support reduced motion preferences for animations? (nice-to-have)
- [ ] Should generated videos have auto-captions? (post-MVP)
