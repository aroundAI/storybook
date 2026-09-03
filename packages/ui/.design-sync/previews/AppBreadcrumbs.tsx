import type { ReactNode } from 'react';

import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';

// AppBreadcrumbs derives its entire item list from `usePathname()`, not from
// the `values` prop alone (`values` only supplies display labels for path
// segments) — with no App Router mounted in this isolated preview bundle,
// the real hook returns null and the breadcrumb renders empty regardless of
// `values`. Providing Next's own internal PathnameContext directly is the
// real fix (not a reimplementation): it's the same context `usePathname`
// reads from inside actual Next.js app router.
//
// Reading it off `window.__dsPathnameContext` (set by preview-background.tsx,
// bundled into the shared _ds_bundle.js) rather than importing
// `next/dist/.../hooks-client-context.shared-runtime` directly here:
// cfg.storyImports.shim now redirects AppBreadcrumbs' own @kit/ui import
// through that same shared bundle, so its internal usePathname() call reads
// the PathnameContext object instantiated THERE — a fresh import in this
// preview's own, separately-bundled file would be a different object, and
// the Provider below would satisfy nothing.
function withPath(path: string, children: ReactNode) {
  const PathnameContext = window.__dsPathnameContext;
  if (!PathnameContext) return children;
  return (
    <PathnameContext.Provider value={path}>{children}</PathnameContext.Provider>
  );
}

export function Default() {
  return withPath(
    '/studio/midnight-frequency/episodes',
    <AppBreadcrumbs
      values={{
        studio: 'Studio',
        'midnight-frequency': 'Midnight Frequency',
        episodes: 'Episodes',
      }}
    />,
  );
}

export function DeepPath() {
  return withPath(
    '/studio/midnight-frequency/episodes/s01e04/visual-studio',
    <AppBreadcrumbs
      maxDepth={4}
      values={{
        studio: 'Studio',
        'midnight-frequency': 'Midnight Frequency',
        episodes: 'Episodes',
        s01e04: 'S01E04',
        'visual-studio': 'Visual Studio',
      }}
    />,
  );
}
