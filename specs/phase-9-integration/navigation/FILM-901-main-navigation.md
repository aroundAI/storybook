---
spec_id: FILM-901
status: 🟡 PARTIAL
audited: 2026-09-23
---

# FILM-901: Main Navigation

## Metadata
- **Phase:** 9 - Integration
- **Priority:** P2 (Post-MVP)
- **Effort:** M (4-8 hours)
- **Status:** 🟡 PARTIAL (audit 2026-09-23; was DONE)
- **Dependencies:** All feature packages
- **Blocks:** None

---

## Context

The main navigation integrates all Film Studio features into a cohesive sidebar and header navigation system. It extends the existing Storybook navigation configuration to add Studio-specific routes while maintaining consistency with the base platform.

---

## Specification

### Requirements

1. **Studio Section**: New top-level navigation section for Film Studio
2. **Project Context**: Show project name in header when in project context
3. **Quick Actions**: Floating action button for common tasks
4. **Status Indicators**: Show active generations, pending publishes
5. **Responsive**: Collapsible sidebar on mobile
6. **Keyboard Navigation**: Full keyboard accessibility

### Navigation Configuration

```typescript
// apps/web/config/studio-navigation.config.tsx

import {
  Film,
  Clapperboard,
  Users,
  Video,
  Music,
  Scissors,
  Share2,
  BarChart3,
  Settings,
  FolderOpen,
  Sparkles,
  Upload,
} from 'lucide-react';

interface NavItem {
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: () => number | null;
  children?: NavItem[];
}

export function getStudioNavigation(params: {
  accountSlug: string;
  projectId?: string;
}): NavItem[] {
  const { accountSlug, projectId } = params;
  const basePath = `/home/${accountSlug}/studio`;

  // Project-level navigation (when inside a project)
  if (projectId) {
    return [
      {
        label: 'Overview',
        path: `${basePath}/${projectId}`,
        icon: FolderOpen,
      },
      {
        label: 'Episodes',
        path: `${basePath}/${projectId}/episodes`,
        icon: Clapperboard,
      },
      {
        label: 'Assets',
        path: `${basePath}/${projectId}/assets`,
        icon: Users,
        children: [
          {
            label: 'Characters',
            path: `${basePath}/${projectId}/assets/characters`,
            icon: Users,
          },
          {
            label: 'Locations',
            path: `${basePath}/${projectId}/assets/locations`,
            icon: MapPin,
          },
          {
            label: 'Voices',
            path: `${basePath}/${projectId}/assets/voices`,
            icon: Music,
          },
        ],
      },
      {
        label: 'Analytics',
        path: `${basePath}/${projectId}/analytics`,
        icon: BarChart3,
      },
      {
        label: 'Settings',
        path: `${basePath}/${projectId}/settings`,
        icon: Settings,
      },
    ];
  }

  // Account-level navigation (Studio home)
  return [
    {
      label: 'All Projects',
      path: basePath,
      icon: Film,
    },
    {
      label: 'Publish Queue',
      path: `${basePath}/publish`,
      icon: Share2,
      badge: getPendingPublishesCount,
    },
    {
      label: 'Analytics',
      path: `${basePath}/analytics`,
      icon: BarChart3,
    },
    {
      label: 'Settings',
      path: `/home/${accountSlug}/settings/studio`,
      icon: Settings,
      children: [
        {
          label: 'API Keys',
          path: `/home/${accountSlug}/settings/api-keys`,
          icon: Key,
        },
        {
          label: 'Platforms',
          path: `/home/${accountSlug}/settings/platforms`,
          icon: Share2,
        },
        {
          label: 'Generation',
          path: `/home/${accountSlug}/settings/generation`,
          icon: Sparkles,
        },
      ],
    },
  ];
}
```

### Studio Sidebar Component

```typescript
// packages/features/film-studio/src/components/studio-sidebar.tsx

'use client';

import { useParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import { cn } from '@kit/ui/utils';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { ScrollArea } from '@kit/ui/scroll-area';
import { ChevronLeft, Plus } from 'lucide-react';
import { getStudioNavigation } from '@/config/studio-navigation.config';
import { GenerationStatusIndicator } from './generation-status-indicator';

interface StudioSidebarProps {
  accountSlug: string;
  projectId?: string;
  projectName?: string;
}

export function StudioSidebar({
  accountSlug,
  projectId,
  projectName,
}: StudioSidebarProps) {
  const pathname = usePathname();
  const navItems = getStudioNavigation({ accountSlug, projectId });

  return (
    <aside className="flex flex-col w-64 border-r bg-background">
      {/* Header */}
      <div className="h-14 border-b flex items-center justify-between px-4">
        {projectId ? (
          <>
            <Link
              href={`/home/${accountSlug}/studio`}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </Link>
            <span className="font-medium truncate max-w-[120px]">
              {projectName}
            </span>
          </>
        ) : (
          <>
            <span className="font-semibold">Film Studio</span>
            <Button size="sm" variant="ghost" asChild>
              <Link href={`/home/${accountSlug}/studio/new`}>
                <Plus className="h-4 w-4" />
              </Link>
            </Button>
          </>
        )}
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 py-4">
        <nav className="space-y-1 px-2">
          {navItems.map((item) => (
            <NavItem
              key={item.path}
              item={item}
              isActive={pathname === item.path}
              pathname={pathname}
            />
          ))}
        </nav>
      </ScrollArea>

      {/* Generation Status */}
      <div className="border-t p-4">
        <GenerationStatusIndicator compact />
      </div>
    </aside>
  );
}

interface NavItemProps {
  item: NavItem;
  isActive: boolean;
  pathname: string;
}

function NavItem({ item, isActive, pathname }: NavItemProps) {
  const { label, path, icon: Icon, badge, children } = item;
  const [expanded, setExpanded] = useState(false);
  const hasChildren = children && children.length > 0;
  const isChildActive = children?.some((c) => pathname.startsWith(c.path));

  return (
    <div>
      <Link
        href={path}
        className={cn(
          'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
          isActive || isChildActive
            ? 'bg-accent text-accent-foreground font-medium'
            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
        )}
        onClick={(e) => {
          if (hasChildren) {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
      >
        <Icon className="h-4 w-4" />
        <span className="flex-1">{label}</span>
        {badge && <Badge variant="secondary" className="text-xs">{badge()}</Badge>}
        {hasChildren && (
          <ChevronRight
            className={cn('h-4 w-4 transition-transform', expanded && 'rotate-90')}
          />
        )}
      </Link>

      {hasChildren && expanded && (
        <div className="ml-6 mt-1 space-y-1">
          {children.map((child) => (
            <Link
              key={child.path}
              href={child.path}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm',
                pathname === child.path
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <child.icon className="h-3.5 w-3.5" />
              {child.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

### Episode Workspace Navigation

```typescript
// packages/features/episodes/src/components/episode-tabs.tsx

'use client';

import { usePathname, useParams } from 'next/navigation';
import Link from 'next/link';
import { cn } from '@kit/ui/utils';
import { BookOpen, Video, Music, Scissors, Share2 } from 'lucide-react';

const EPISODE_TABS = [
  { label: 'Story', segment: 'story', icon: BookOpen },
  { label: 'Visual', segment: 'visual', icon: Video },
  { label: 'Audio', segment: 'audio', icon: Music },
  { label: 'Edit', segment: 'edit', icon: Scissors },
  { label: 'Publish', segment: 'publish', icon: Share2 },
];

export function EpisodeTabs() {
  const pathname = usePathname();
  const params = useParams();
  const basePath = `/home/${params.account}/studio/${params.projectId}/episodes/${params.episodeId}`;

  return (
    <div className="border-b">
      <nav className="flex gap-1 px-4" aria-label="Episode sections">
        {EPISODE_TABS.map((tab) => {
          const href = `${basePath}/${tab.segment}`;
          const isActive = pathname.endsWith(tab.segment) ||
            (tab.segment === 'story' && pathname === basePath);

          return (
            <Link
              key={tab.segment}
              href={href}
              className={cn(
                'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              )}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
```

### Integration with Existing Navigation

```typescript
// apps/web/config/personal-account-navigation.config.tsx

// Add to existing navigation configuration:

{
  label: 'Studio',
  path: pathsConfig.app.studio,
  Icon: Film,
},
```

### File Changes

| Action | Path |
|--------|------|
| CREATE | `apps/web/config/studio-navigation.config.tsx` |
| CREATE | `packages/features/film-studio/src/components/studio-sidebar.tsx` |
| CREATE | `packages/features/episodes/src/components/episode-tabs.tsx` |
| MODIFY | `apps/web/config/personal-account-navigation.config.tsx` |

---

## Acceptance Criteria

- [x] Studio appears in main app navigation
- [x] Account-level navigation shows all projects
- [x] Project-level navigation shows episodes, assets, analytics
- [x] Episode tabs switch between Story/Visual/Audio/Edit/Publish
- [ ] Active state correctly highlights current route — *audit: no longer true* — Characters and Locations test `pathname` for "character"/"location", which live in `?tab=`, so they never highlight — `apps/web/app/home/[account]/studio/[projectSlug]/_components/studio-sidebar.tsx:460`
- [ ] Badge shows pending publish count (deferred to FILM-903) — *audit: not met* — deferred at ship time: no nav item carries a publish count, and FILM-903 is retired
- [x] Back button returns to projects list
- [x] Sidebar collapsible on mobile (via existing ResponsiveLayout) — *audit:* now a `Sheet` in `MobileStudioHeader` (`apps/web/app/home/[account]/studio/[projectSlug]/_components/mobile-studio-header.tsx:137`), the desktop sidebar being `hidden md:block` (`layout.tsx:117`); `ResponsiveLayout` went in 5f44d0e1
- [ ] Keyboard navigation works throughout (via Radix primitives) — *audit: unverified* — needs a keyboard-only walk-through or E2E; no test found

---

## Test Plan

### Unit Tests
- [ ] Test `getStudioNavigation` with different params — *audit: not met* — no test found; `getStudioNavigationConfig` (`apps/web/config/studio-navigation.config.tsx:101`) has no callers
- [ ] Test active state detection — *audit: not met* — no test found

### Integration Tests
- [ ] Test navigation between sections — *audit: not met* — no test found
- [x] Test deep linking to episode tabs — *audit:* `apps/e2e/tests/refusals/refusals.po.ts:209` (a direct `goto` to `audio-studio`; incidental, no tab-state assertion)

---

## Accessibility

- Proper ARIA labels on navigation landmarks
- Focus management on route changes
- Skip links to main content
- Keyboard arrow navigation in sidebar

## Remaining (audit 2026-09-23)

| Criterion | Why it is open | Closed by |
|---|---|---|
| Active state correctly highlights current route | `studio-sidebar.tsx:460-471` mark Characters and Locations active when `pathname` includes "character"/"location"; their links are `assets?tab=character` / `assets?tab=location`, and `usePathname` carries no query string, so on the assets page neither highlights (or one does whenever the project slug contains the word). Found by reading; not run | unassigned |
