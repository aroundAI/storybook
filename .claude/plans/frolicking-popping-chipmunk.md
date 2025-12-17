# Plan: Analytics Dashboard Redesign

## Goal
Redesign the analytics page based on prototype HTML files in `/Analytics/` folder, copying the exact UI structure and styling from the prototypes while wiring up our existing backend data.

## Prototype Reference Files
- `/Analytics/Overview/code.html` - Overview tab design
- `/Analytics/Content/code.html` - Content tab design
- `/Analytics/Audience/code.html` - Audience tab design
- `/Analytics/Insights/code.html` - AI Insights tab design

---

## Tab 1: Overview (from Overview/code.html)

**Layout**: 4-column masonry grid with 10 cards

| Card | Spans | Visualization | Data Source |
|------|-------|---------------|-------------|
| Total Views | 1 col | SVG sparkline area chart (green) | totals.views |
| Total Likes | 1 col | Mini bar chart (5 bars) | totals.likes |
| Platform Split | 1 col | Horizontal progress bars | platformMetrics |
| Comments | 1 col | Large number + text callout | totals.comments + topCommented |
| AI Performance Insight | 2 cols | Gradient card with bullet points | InsightsResult.summary |
| Shares | 1 col | SVG donut chart (Direct/Copy Link) | totals.shares |
| Top Performing Content | 2 cols | List with thumbnails + metrics | topContent |
| Est. Revenue | 1 col | Stacked progress bars | revenueCents + breakdown |
| Top Regions | 1 col | List with flag emojis | geography |
| Gender | 1 col | Horizontal bars (blue/pink) | demographics.genders |

**Key Styling** (from prototype):
- Cards: `rounded-2xl p-6 shadow-sm border border-border-light hover:shadow-md h-64`
- AI card: `bg-gradient-to-br from-indigo-50 to-purple-50`
- Badge: `bg-green-50 text-green-700` for trends

---

## Tab 2: Content (from Content/code.html)

**Layout**: Responsive card grid (4 cols XL, 3 LG, 2 MD, 1 mobile)

**Content Card Structure**:
```
┌──────────────────────────┐
│  [Thumbnail 16:9]        │
│         [Platform Badge] │
├──────────────────────────┤
│  Title (truncated)       │
│  Episode name (gray)     │
├──────────────────────────┤
│  Views    │  Likes       │
│  3.6M     │  222.1K      │
│  Comments │  Engagement  │
│  19.5K    │  9.9% (green)│
├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┤
│  Published    Dec 16, 2025│
└──────────────────────────┘
```

**Platform Badge Colors**:
- TikTok: `bg-black text-white` + cyan dot
- YouTube: `bg-red-600 text-white` + white dot
- Instagram: `bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600` + white dot

---

## Tab 3: Audience (from Audience/code.html)

**Layout**: Masonry grid with `grid-template-columns: repeat(auto-fill, minmax(320px, 1fr))`

| Card | Features | Data |
|------|----------|------|
| Age Distribution | Horizontal bars (gray/primary), footer insight | demographics.ageGroups |
| Gender Split | SVG donut (blue 58% / pink 38.5%), legend below | demographics.genders |
| Top Geographies | Flag emojis + horizontal bars, `row-span-2` | geography |
| Device Type | Icons (smartphone/computer/tablet) + bars | deviceType (mock) |
| Peak Activity | 7x4 heatmap grid with opacity gradients | peakActivity (mock) |
| Audience Interests | Colored tag pills + Content Affinity section | interests (mock) |

**Card Footer Pattern**:
```html
<div class="px-5 py-3 bg-gray-50 dark:bg-white/5 border-t">
  <p class="text-xs text-gray-500">AI-generated insight text...</p>
</div>
```

---

## Tab 4: AI Insights (from Insights/code.html)

**Layout**:
1. Header: "AI Insights" + "Powered by Claude" badge + Refresh button
2. Summary: Gradient card with paragraph highlighting key metrics in bold
3. 2x2 grid of insight cards

**Insight Cards**:
| Card | Icon BG | Bullet Color |
|------|---------|--------------|
| Content Recommendations | `bg-blue-50` | `bg-blue-500` |
| Optimal Posting Times | `bg-orange-50` | `bg-orange-500` |
| Audience Insights | `bg-pink-50` | `bg-pink-500` |
| Recommended Actions | `bg-amber-50` (highlighted) | Numbered circles |

---

## Implementation Plan

### Phase 1: Shared Components (charts/)
Create in `packages/features/content-analytics/src/components/charts/`:

1. **`sparkline-area.tsx`** - SVG area chart with gradient fill
2. **`mini-bar-chart.tsx`** - 5-bar vertical bar chart
3. **`horizontal-progress.tsx`** - Progress bar with label and percentage
4. **`donut-chart.tsx`** - SVG donut with segments and center label
5. **`heatmap-grid.tsx`** - 7x4 opacity-based activity grid
6. **`tag-cloud.tsx`** - Colored tag pills

### Phase 2: Overview Tab Components
Create in `packages/features/content-analytics/src/components/overview/`:

1. **`overview-grid.tsx`** - Main 4-column grid container
2. **`views-card.tsx`** - SparklineArea chart
3. **`likes-card.tsx`** - MiniBarChart
4. **`platform-split-card.tsx`** - HorizontalProgress bars
5. **`comments-card.tsx`** - Number + callout text
6. **`ai-insight-card.tsx`** - Gradient + bullets
7. **`shares-card.tsx`** - DonutChart
8. **`top-content-card.tsx`** - List with thumbnails
9. **`revenue-card.tsx`** - Stacked progress bars
10. **`top-regions-card.tsx`** - Flag emojis + text
11. **`gender-card.tsx`** - Blue/pink bars

### Phase 3: Content Tab
Create in `packages/features/content-analytics/src/components/`:

1. **`content-grid.tsx`** - Replace content-table.tsx
2. **`content-card.tsx`** - Individual card with thumbnail, metrics

### Phase 4: Audience Tab Components
Create in `packages/features/content-analytics/src/components/audience/`:

1. **`audience-grid.tsx`** - Masonry container
2. **`age-distribution-card.tsx`**
3. **`gender-split-card.tsx`** - DonutChart
4. **`geography-card.tsx`** - Flags + bars
5. **`device-type-card.tsx`** - Icons + bars
6. **`peak-activity-card.tsx`** - HeatmapGrid
7. **`interests-card.tsx`** - TagCloud + affinity

### Phase 5: AI Insights Tab
Update `packages/features/content-analytics/src/components/ai-insights.tsx`:
- Add gradient summary section
- Restructure into 2x2 grid
- Add colored icon containers

### Phase 6: Types & Data Layer
Update in `packages/features/content-analytics/src/`:

**types.ts** - Add:
```typescript
interface ExtendedAudienceData {
  deviceType?: Record<string, number>;
  peakActivity?: number[][];
  interests?: string[];
  contentAffinity?: { label: string; percentage: number };
}
interface RevenueBreakdown { adRevenue: number; sponsorships: number }
interface ShareBreakdown { direct: number; copyLink: number }
```

**server/aggregation-queries.ts** - Add:
- `getExtendedAudienceData()` - Fetch device/activity from raw_data or return mock

### Phase 7: Seed Data Updates
Update `apps/web/supabase/seeds/analytics-mock-data.sql`:

Add to `raw_data` JSONB:
```json
{
  "deviceType": {"mobile": 78, "desktop": 18, "tablet": 4},
  "peakActivity": [[0.2,0.3,0.4,0.6,0.8,0.9,0.7], ...],
  "interests": ["Sci-Fi Movies", "Gaming", "Animation", ...],
  "shareBreakdown": {"direct": 83, "copyLink": 17},
  "revenueBreakdown": {"adRevenue": 6240, "sponsorships": 2676}
}
```

---

## Critical Files to Modify

| File | Changes |
|------|---------|
| `src/components/analytics-dashboard.tsx` | Replace tab content with new layouts |
| `src/components/metric-cards.tsx` | Keep as-is (horizontal KPI bar) |
| `src/components/ai-insights.tsx` | Redesign with gradient + 2x2 grid |
| `src/types.ts` | Add ExtendedAudienceData, breakdown types |
| `src/server/aggregation-queries.ts` | Add getExtendedAudienceData |
| `seeds/analytics-mock-data.sql` | Add device, activity, interests mock data |

---

## Data Gap Summary

| Feature | YouTube API | TikTok | Instagram | Solution |
|---------|-------------|--------|-----------|----------|
| Device Type | ✅ deviceType dimension | ❌ | ❌ | Implement YT, mock others |
| Peak Activity | ✅ hour/dayOfWeek | ❌ | ❌ | Implement YT, mock others |
| Share breakdown | ❌ | ❌ | ❌ | Mock data only |
| Revenue breakdown | ❌ | ❌ | ❌ | Mock data only |
| Audience interests | ❌ | ❌ | ❌ | Mock data only |

---

## Design Tokens (from prototypes)

```css
/* Colors */
--primary: #007AFF (Overview) / #3b82f6 (Audience) / #2563eb (Insights)
--background-light: #F5F5F7
--surface-light: #FFFFFF
--border-light: #E5E5EA

/* Card Styling */
rounded-2xl shadow-sm border hover:shadow-md

/* Platform Colors */
TikTok: bg-black + cyan dot (#00F2EA)
YouTube: bg-red-600 + white dot
Instagram: gradient(yellow-red-purple) + white dot

/* AI Gradient */
bg-gradient-to-br from-indigo-50 to-purple-50
```
