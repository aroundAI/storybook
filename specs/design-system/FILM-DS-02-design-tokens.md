# FILM-DS-02: Design Tokens

## Metadata
- **Phase:** Design System
- **Priority:** P0 (Critical)
- **Effort:** S (2-4 hours)
- **Dependencies:** FILM-DS-01 (Component Inventory)
- **Blocks:** All UI component implementations

---

## Context

Consistent visual language across the Film Studio requires standardized design tokens. These tokens define colors, spacing, and semantic meanings for statuses, asset types, and timeline tracks.

---

## Specification

### Token Categories

#### 1. Generation Status Colors

Used for job status badges, shot overlays, and progress indicators:

```typescript
// packages/features/film-studio/src/lib/design-tokens.ts

export const statusTokens = {
  pending: {
    bg: 'bg-slate-100 dark:bg-slate-800',
    text: 'text-slate-600 dark:text-slate-400',
    border: 'border-slate-200 dark:border-slate-700',
    ring: 'ring-slate-300 dark:ring-slate-600',
    icon: 'Clock',
    label: 'Pending',
  },
  queued: {
    bg: 'bg-amber-100 dark:bg-amber-900/30',
    text: 'text-amber-700 dark:text-amber-400',
    border: 'border-amber-200 dark:border-amber-800',
    ring: 'ring-amber-300 dark:ring-amber-600',
    icon: 'Hourglass',
    label: 'Queued',
  },
  generating: {
    bg: 'bg-blue-100 dark:bg-blue-900/30',
    text: 'text-blue-700 dark:text-blue-400',
    border: 'border-blue-200 dark:border-blue-800',
    ring: 'ring-blue-300 dark:ring-blue-600',
    icon: 'Loader2', // animated
    label: 'Generating',
  },
  completed: {
    bg: 'bg-green-100 dark:bg-green-900/30',
    text: 'text-green-700 dark:text-green-400',
    border: 'border-green-200 dark:border-green-800',
    ring: 'ring-green-300 dark:ring-green-600',
    icon: 'CheckCircle',
    label: 'Completed',
  },
  failed: {
    bg: 'bg-red-100 dark:bg-red-900/30',
    text: 'text-red-700 dark:text-red-400',
    border: 'border-red-200 dark:border-red-800',
    ring: 'ring-red-300 dark:ring-red-600',
    icon: 'XCircle',
    label: 'Failed',
  },
  approved: {
    bg: 'bg-purple-100 dark:bg-purple-900/30',
    text: 'text-purple-700 dark:text-purple-400',
    border: 'border-purple-200 dark:border-purple-800',
    ring: 'ring-purple-300 dark:ring-purple-600',
    icon: 'BadgeCheck',
    label: 'Approved',
  },
} as const;

export type StatusType = keyof typeof statusTokens;
```

#### 2. Asset Type Colors

Used for asset cards, type badges, and filters:

```typescript
export const assetTypeTokens = {
  character: {
    bg: 'bg-pink-500',
    bgLight: 'bg-pink-100 dark:bg-pink-900/30',
    text: 'text-pink-700 dark:text-pink-400',
    icon: 'User',
    label: 'Character',
  },
  location: {
    bg: 'bg-emerald-500',
    bgLight: 'bg-emerald-100 dark:bg-emerald-900/30',
    text: 'text-emerald-700 dark:text-emerald-400',
    icon: 'MapPin',
    label: 'Location',
  },
  prop: {
    bg: 'bg-orange-500',
    bgLight: 'bg-orange-100 dark:bg-orange-900/30',
    text: 'text-orange-700 dark:text-orange-400',
    icon: 'Box',
    label: 'Prop',
  },
  voice: {
    bg: 'bg-violet-500',
    bgLight: 'bg-violet-100 dark:bg-violet-900/30',
    text: 'text-violet-700 dark:text-violet-400',
    icon: 'Mic',
    label: 'Voice',
  },
  music: {
    bg: 'bg-amber-500',
    bgLight: 'bg-amber-100 dark:bg-amber-900/30',
    text: 'text-amber-700 dark:text-amber-400',
    icon: 'Music',
    label: 'Music',
  },
  sfx: {
    bg: 'bg-cyan-500',
    bgLight: 'bg-cyan-100 dark:bg-cyan-900/30',
    text: 'text-cyan-700 dark:text-cyan-400',
    icon: 'Volume2',
    label: 'Sound Effect',
  },
} as const;

export type AssetType = keyof typeof assetTypeTokens;
```

#### 3. Timeline Track Colors

Used for the multi-track timeline editor:

```typescript
export const timelineTrackTokens = {
  video: {
    bg: 'bg-blue-600',
    bgHover: 'bg-blue-500',
    border: 'border-blue-700',
    text: 'text-white',
    label: 'Video',
  },
  dialogue: {
    bg: 'bg-green-600',
    bgHover: 'bg-green-500',
    border: 'border-green-700',
    text: 'text-white',
    label: 'Dialogue',
  },
  music: {
    bg: 'bg-purple-600',
    bgHover: 'bg-purple-500',
    border: 'border-purple-700',
    text: 'text-white',
    label: 'Music',
  },
  sfx: {
    bg: 'bg-amber-600',
    bgHover: 'bg-amber-500',
    border: 'border-amber-700',
    text: 'text-white',
    label: 'SFX',
  },
  ambient: {
    bg: 'bg-slate-600',
    bgHover: 'bg-slate-500',
    border: 'border-slate-700',
    text: 'text-white',
    label: 'Ambient',
  },
} as const;

export type TrackType = keyof typeof timelineTrackTokens;
```

#### 4. Episode Status Workflow

Used for episode progress and pipeline visualization:

```typescript
export const episodeStatusTokens = {
  draft: {
    label: 'Draft',
    color: 'slate',
    step: 0,
    description: 'Episode created, no content yet',
  },
  story: {
    label: 'Story',
    color: 'blue',
    step: 1,
    description: 'Story generated and approved',
  },
  storyboard: {
    label: 'Storyboard',
    color: 'indigo',
    step: 2,
    description: 'Shot list generated',
  },
  generating: {
    label: 'Generating',
    color: 'amber',
    step: 3,
    description: 'Videos/audio being generated',
  },
  editing: {
    label: 'Editing',
    color: 'purple',
    step: 4,
    description: 'In timeline editor',
  },
  ready: {
    label: 'Ready',
    color: 'green',
    step: 5,
    description: 'Ready for publishing',
  },
  published: {
    label: 'Published',
    color: 'emerald',
    step: 6,
    description: 'Published to platforms',
  },
} as const;

export type EpisodeStatus = keyof typeof episodeStatusTokens;
```

#### 5. Provider Brand Colors

Used for provider selection and connection status:

```typescript
export type ProviderCategory = 'video' | 'audio' | 'platform';

export const providerTokens = {
  // Video providers
  kling: {
    name: 'Kling',
    bg: 'bg-indigo-600',
    icon: 'Video',
    category: 'video' as const,
  },
  runway: {
    name: 'Runway',
    bg: 'bg-violet-600',
    icon: 'Film',
    category: 'video' as const,
  },
  hailuo: {
    name: 'Hailuo',
    bg: 'bg-sky-600',
    icon: 'Clapperboard',
    category: 'video' as const,
  },
  // Audio providers
  elevenlabs: {
    name: 'ElevenLabs',
    bg: 'bg-emerald-600',
    icon: 'AudioLines',
    category: 'audio' as const,
  },
  playht: {
    name: 'PlayHT',
    bg: 'bg-teal-600',
    icon: 'Mic2',
    category: 'audio' as const,
  },
  suno: {
    name: 'Suno',
    bg: 'bg-orange-600',
    icon: 'Music4',
    category: 'audio' as const,
  },
  udio: {
    name: 'Udio',
    bg: 'bg-rose-600',
    icon: 'Music2',
    category: 'audio' as const,
  },
  // Platforms
  youtube: {
    name: 'YouTube',
    bg: 'bg-red-600',
    icon: 'Youtube',
    category: 'platform' as const,
  },
  tiktok: {
    name: 'TikTok',
    bg: 'bg-black dark:bg-white',
    icon: 'Music2',
    category: 'platform' as const,
  },
  instagram: {
    name: 'Instagram',
    bg: 'bg-gradient-to-r from-purple-500 via-pink-500 to-orange-500',
    icon: 'Instagram',
    category: 'platform' as const,
  },
  facebook: {
    name: 'Facebook',
    bg: 'bg-blue-600',
    icon: 'Facebook',
    category: 'platform' as const,
  },
} as const;
```

### Utility Functions

```typescript
// Helper to get status token with type safety
export function getStatusToken(status: StatusType) {
  return statusTokens[status];
}

// Helper to compose Tailwind classes for status
export function getStatusClasses(status: StatusType): string {
  const token = statusTokens[status];
  return `${token.bg} ${token.text} ${token.border}`;
}

// Helper for asset type badge
export function getAssetTypeBadge(type: AssetType) {
  const token = assetTypeTokens[type];
  return {
    className: `${token.bgLight} ${token.text}`,
    icon: token.icon,
    label: token.label,
  };
}
```

### File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/film-studio/src/lib/design-tokens.ts` |
| CREATE | `packages/features/film-studio/src/lib/design-tokens.test.ts` |

---

## Acceptance Criteria

- [x] All status states have distinct, accessible colors
- [x] Dark mode variants are defined for all tokens
- [x] Token names match database enum values
- [x] Helper functions provide type-safe access
- [x] Colors meet WCAG AA contrast requirements
- [x] Icons are specified using Lucide icon names

---

## Test Plan

### Unit Tests
- [x] Test getStatusToken returns correct values
- [x] Test getStatusClasses composes correctly
- [x] Test all token types are exported
- [x] Test TypeScript types match token keys

---

## Accessibility Considerations

- All color combinations must meet WCAG AA (4.5:1 contrast)
- Status indicators use icons + color (never color alone)
- Dark mode tokens tested for visibility
- Focus states visible on all interactive elements

---

## Open Questions

- [x] Should we use CSS variables instead of Tailwind classes? **No, Tailwind for consistency with @kit/ui**
- [ ] Should provider colors match official brand guidelines? (nice-to-have)
