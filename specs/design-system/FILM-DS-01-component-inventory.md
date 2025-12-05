# FILM-DS-01: Component Inventory

## Metadata
- **Phase:** Design System
- **Priority:** P0 (Critical)
- **Effort:** S (2-4 hours)
- **Dependencies:** None
- **Blocks:** All UI component specs

---

## Context

The Film Studio introduces complex UI patterns not covered by the base @kit/ui library. This spec inventories all components needed, categorizing them by reuse potential and complexity.

---

## Specification

### Component Categories

#### 1. Reusable from @kit/ui (70% coverage)

These components require no modification:

| Component | Usage in Film Studio |
|-----------|---------------------|
| `Card`, `CardHeader`, `CardContent` | Asset cards, episode cards, shot cards |
| `Button`, `IconButton` | All actions and CTAs |
| `Dialog`, `Sheet` | Modals, side panels, editors |
| `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` | Studio workspace navigation |
| `Form`, `FormField`, `FormItem`, `FormLabel` | All input forms |
| `Input`, `Textarea` | Text inputs throughout |
| `Select`, `Combobox` | Dropdowns, provider selection |
| `Progress` | Linear progress indicators |
| `Badge` | Status labels, tags |
| `Table`, `TableHeader`, `TableRow`, `TableCell` | Analytics data display |
| `Tooltip` | Help text, hover info |
| `Skeleton` | Loading states |
| `Alert`, `AlertTitle`, `AlertDescription` | Notifications, warnings |
| `Avatar` | Character thumbnails |
| `Checkbox`, `RadioGroup` | Multi-select, options |
| `Slider` | Volume, timeline zoom |
| `Switch` | Toggle settings |
| `Popover` | Contextual menus |
| `DropdownMenu` | Action menus |
| `ScrollArea` | Scrollable containers |
| `Separator` | Visual dividers |

#### 2. New High-Complexity Components

These require dedicated design and implementation:

| Component | Purpose | Effort | Package |
|-----------|---------|--------|---------|
| `TimelineEditor` | Multi-track video/audio timeline with scrubbing | XL | @kit/episodes |
| `ShotGrid` | Draggable grid with generation overlays | L | @kit/episodes |
| `WaveformVisualizer` | Audio waveform with playhead sync | M | @kit/audio-generation |
| `VideoPlayer` | Custom player with frame-accurate seeking | M | @kit/episodes |
| `CharacterCard` | Reference images + element prompt preview | M | @kit/assets |

#### 3. Medium-Complexity Extensions

These extend existing @kit/ui components:

| Component | Base Component | Extension | Effort |
|-----------|---------------|-----------|--------|
| `GenerationStatusBadge` | `Badge` | Animated states, progress ring | S |
| `ProgressRing` | New (SVG) | Circular progress for jobs | S |
| `AssetPicker` | `Dialog` + `Combobox` | Modal with preview, search | M |
| `PromptEditor` | `Textarea` | Token counter, variables | M |
| `CostEstimate` | `Badge` | Credits display, warnings | S |

#### 4. Low-Complexity Compositions

These compose existing components:

| Component | Composition | Effort |
|-----------|-------------|--------|
| `StudioSidebar` | `Nav` + `Badge` + `Tooltip` | S |
| `EpisodeCard` | `Card` + `Badge` + `Progress` + menu | S |
| `PipelineProgress` | `Steps` + `Progress` + status | S |
| `ShotCard` | `Card` + `Badge` + overlay + menu | S |
| `DialogueLine` | `Card` + `Avatar` + play button | S |

### Component Hierarchy

```
Studio Layout
├── StudioSidebar
│   ├── Navigation links
│   └── GenerationQueueIndicator
│
├── StudioHeader
│   ├── Breadcrumbs
│   └── ActionButtons
│
├── WorkspaceContent
│   ├── StoryStudio
│   │   ├── StoryIdeation
│   │   ├── StoryEditor
│   │   ├── ScreenplayViewer
│   │   └── ShotListEditor
│   │
│   ├── VisualStudio
│   │   ├── ShotGrid
│   │   │   └── ShotCard (×n)
│   │   ├── GenerationSettings
│   │   └── BatchActions
│   │
│   ├── AudioStudio
│   │   ├── DialogueList
│   │   │   └── DialogueLine (×n)
│   │   ├── VoiceAssignment
│   │   ├── MusicGenerator
│   │   └── WaveformVisualizer
│   │
│   ├── EditSuite
│   │   ├── TimelineEditor
│   │   │   ├── TrackLayer (×n)
│   │   │   └── Playhead
│   │   └── ClipEditor
│   │
│   └── PublishHub
│       ├── PlatformSelector
│       ├── MetadataEditor
│       └── ShortsClipper
│
└── GenerationQueuePanel (slide-over)
    └── QueueItem (×n)
```

### File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/film-studio/src/components/index.ts` |
| CREATE | `packages/features/episodes/src/components/index.ts` |
| CREATE | `packages/features/assets/src/components/index.ts` |
| CREATE | `packages/features/audio-generation/src/components/index.ts` |

---

## Acceptance Criteria

- [ ] All required components are identified and categorized
- [ ] Each component has clear ownership (package)
- [ ] Effort estimates are provided for planning
- [ ] Component hierarchy shows relationships
- [ ] No duplicate components across packages

---

## Component Export Pattern

Each feature package exports components from a single entry point:

```typescript
// packages/features/episodes/src/components/index.ts

export { ShotGrid } from './shot-grid';
export { ShotCard } from './shot-card';
export { StoryStudio } from './story-studio';
export { StoryIdeation } from './story-ideation';
export { ScreenplayViewer } from './screenplay-viewer';
export { ShotListEditor } from './shot-list-editor';
export { VisualStudio } from './visual-studio';
export { EpisodeCard } from './episode-card';
export { PipelineProgress } from './pipeline-progress';
```

---

## Open Questions

- [ ] Should we create a `@kit/studio-ui` package for shared studio components? (non-blocking)
- [ ] Should `TimelineEditor` be extracted to its own package for reuse? (post-MVP)
