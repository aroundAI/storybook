# @kit/ui conventions

## No provider wrapper required

Components need no root-level context provider. The "Cinema" dark-mode palette is
declared on `:root` in `_ds_bundle.css` — all semantic color tokens resolve without
a `ThemeProvider` or `.dark` class anywhere in the tree. Just import and render.

Two components are exceptions and need their own context inline:
- **`MultiStepForm`** calls `useMutation` internally → wrap it in `QueryClientProvider`
  from `@tanstack/react-query` (every real Next.js app already has one at the app level)
- **`LanguageSelector`** / **`BorderedNavigationMenuItem`** call `useTranslation` →
  they need an initialized `i18next` instance in their tree (apps using this library
  already have `i18n` wired at the root)

## Styling — Tailwind v4 utility classes + semantic color tokens

This library uses **Tailwind v4** classes. Components accept a `className` prop and
merge with `cn()` from `@kit/ui/cn`. For layout glue that you write yourself, use the
same semantic color utilities the components use internally:

| Role | Utility class |
|---|---|
| Page/surface background | `bg-background` |
| Default text | `text-foreground` |
| Card background | `bg-card` |
| Muted/secondary text | `text-muted-foreground` |
| Subtle fill (inputs, etc.) | `bg-muted` |
| Brand primary | `bg-primary` / `text-primary-foreground` |
| Secondary fill | `bg-secondary` / `text-secondary-foreground` |
| Accent fill | `bg-accent` / `text-accent-foreground` |
| Danger/destructive | `bg-destructive` / `text-destructive-foreground` |
| Border | `border` + `border-border` |

Radius scale: `rounded-sm` (4 px) · `rounded-md` (6 px) · `rounded-lg` (8 px) · `rounded-xl` (12 px).

**Do not invent new token names.** If a semantic class you need isn't in the table above,
read `_ds_bundle.css` — every CSS custom property defined there (e.g. `--color-red-500`,
`--radius-md`) is safe to reference as a `var(--…)` inline style or as a Tailwind
arbitrary value (`bg-[var(--color-…)]`). Hardcoded hex or `gray-*` scales are off-brand.

## Import pattern

Every component ships via a named subpath export — never import from the barrel `@kit/ui`:

```ts
import { Button } from '@kit/ui/button'
import { Card, CardHeader, CardContent } from '@kit/ui/card'
import { Input } from '@kit/ui/input'
import { cn } from '@kit/ui/cn'
```

Available subpaths: `accordion` · `alert` · `alert-dialog` · `avatar` · `badge` ·
`bordered-navigation-menu` · `breadcrumb` · `button` · `calendar` · `card` · `card-button` ·
`chart` · `checkbox` · `collapsible` · `command` · `cookie-banner` · `data-table` ·
`dialog` · `dropdown-menu` · `empty-state` · `enhanced-data-table` · `file-uploader` ·
`form` · `global-loader` · `heading` · `hooks` · `if` · `image-uploader` · `input` ·
`input-otp` · `label` · `language-selector` · `loading-overlay` · `marketing` ·
`mobile-mode-toggle` · `mode-toggle` · `multi-step-form` · `navigation-menu` ·
`oauth-provider-logo-image` · `page` · `popover` · `profile-avatar` · `progress` ·
`radio-group` · `scroll-area` · `select` · `separator` · `sheet` · `sidebar` ·
`shadcn-sidebar` · `skeleton` · `slider` · `sonner` · `spinner` · `stepper` ·
`switch` · `table` · `tabs` · `textarea` · `toggle-group` · `tooltip` · `trans`

For the sidebar family: `@kit/ui/sidebar` exports the MakerKit opinionated sidebar
(`Sidebar`, `SidebarContent`, `SidebarGroup`, `SidebarNavigation`);
`@kit/ui/shadcn-sidebar` exports the raw shadcn primitives
(`Sidebar` → same token but lower-level, plus all sub-parts).

## Where to look first

- Per-component API: `components/<group>/<Name>/<Name>.d.ts` and `<Name>.prompt.md`
- Token list: `_ds_bundle.css` (search `var(--`)
- Full component list: this README's Components section below

## Idiomatic snippet

```tsx
import { Card, CardHeader, CardTitle, CardContent } from '@kit/ui/card'
import { Button } from '@kit/ui/button'
import { Badge } from '@kit/ui/badge'
import { cn } from '@kit/ui/cn'

export function EpisodeCard({ title, status, className }: {
  title: string
  status: 'draft' | 'published'
  className?: string
}) {
  return (
    <Card className={cn('w-full max-w-sm', className)}>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <Badge variant={status === 'published' ? 'default' : 'secondary'}>
          {status}
        </Badge>
      </CardHeader>
      <CardContent>
        <Button size="sm" className="w-full">Open in Studio</Button>
      </CardContent>
    </Card>
  )
}
```
