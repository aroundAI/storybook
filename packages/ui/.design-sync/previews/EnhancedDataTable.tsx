import type { ReactNode } from 'react';

import { Badge } from '@kit/ui/badge';
// The real file (src/makerkit/data-table.tsx) only exports `DataTable` —
// `EnhancedDataTable` is an alias that exists ONLY in the synth-entry main
// bundle's namespace (window.KitUi.EnhancedDataTable, disambiguating it
// from shadcn's window.KitUi.DataTable). Now that cfg.storyImports.shim
// redirects every @kit/ui/src/* import through that SAME window.KitUi
// namespace (named imports resolve via a star re-export of the whole
// global, not the real file's actual exports), importing the ALIAS name
// directly is what's needed — importing `DataTable` here would silently
// resolve to the WRONG (shadcn) component instead of failing loudly, since
// shadcn's plain DataTable also renders fine standalone with no crash.
// Not real TypeScript (the real file has no such export) but this dir
// isn't in tsconfig's `include`, and esbuild doesn't type-check.
import { EnhancedDataTable } from '@kit/ui/enhanced-data-table';
import type { ColumnDef } from '@kit/ui/enhanced-data-table';

// EnhancedDataTable's pagination calls useRouter() unconditionally (a hook,
// can't be conditional even though pagination is externally controlled
// here via onPaginationChange) — useRouter() throws ("invariant expected
// app router to be mounted") with no App Router in this isolated preview
// bundle, unlike usePathname() which degrades to null. A minimal stub
// router (only .push is ever called, only on a pagination click that never
// fires in a static screenshot) satisfies the null-check.
//
// Reading the context off `window.__dsAppRouterContext` (set by
// preview-background.tsx, bundled into the shared _ds_bundle.js) rather
// than importing `next/dist/.../app-router-context.shared-runtime` directly
// here: cfg.storyImports.shim redirects EnhancedDataTable's own @kit/ui
// import through that same shared bundle, so its internal useRouter() call
// reads the AppRouterContext object instantiated THERE — a fresh import in
// this preview's own, separately-bundled file would be a different object.
const fakeRouter = {
  push: () => {},
  replace: () => {},
  back: () => {},
  forward: () => {},
  refresh: () => {},
  prefetch: () => {},
};

function withRouter(children: ReactNode) {
  const AppRouterContext = window.__dsAppRouterContext;
  if (!AppRouterContext) return children;
  return (
    <AppRouterContext.Provider value={fakeRouter as never}>
      {children}
    </AppRouterContext.Provider>
  );
}

interface EpisodeRow {
  id: string;
  title: string;
  status: 'draft' | 'in_production' | 'published';
  duration: string;
  createdAt: string;
}

const data: EpisodeRow[] = [
  {
    id: '1',
    title: 'Pilot — Origins',
    status: 'published',
    duration: '8:24',
    createdAt: '2026-05-02',
  },
  {
    id: '2',
    title: 'Episode 2 — The Signal',
    status: 'in_production',
    duration: '6:51',
    createdAt: '2026-05-09',
  },
  {
    id: '3',
    title: 'Episode 3 — Aftermath',
    status: 'in_production',
    duration: '7:10',
    createdAt: '2026-05-16',
  },
  {
    id: '4',
    title: 'Episode 4 — Reckoning',
    status: 'draft',
    duration: '—',
    createdAt: '2026-05-23',
  },
  {
    id: '5',
    title: 'Episode 5 — New Dawn',
    status: 'draft',
    duration: '—',
    createdAt: '2026-05-30',
  },
];

const statusVariant: Record<EpisodeRow['status'], 'default' | 'secondary' | 'outline'> = {
  published: 'default',
  in_production: 'secondary',
  draft: 'outline',
};

const statusLabel: Record<EpisodeRow['status'], string> = {
  published: 'Published',
  in_production: 'In production',
  draft: 'Draft',
};

const columns: ColumnDef<EpisodeRow>[] = [
  {
    accessorKey: 'title',
    header: 'Title',
    cell: ({ row }) => (
      <span className="font-medium">{row.original.title}</span>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <Badge variant={statusVariant[row.original.status]}>
        {statusLabel[row.original.status]}
      </Badge>
    ),
  },
  {
    accessorKey: 'duration',
    header: 'Duration',
  },
  {
    accessorKey: 'createdAt',
    header: 'Created',
  },
];

export function Default() {
  return withRouter(
    <div className="w-full max-w-3xl">
      <EnhancedDataTable
        data={data}
        columns={columns}
        pageIndex={0}
        pageSize={5}
        pageCount={1}
        onPaginationChange={() => {}}
      />
    </div>,
  );
}

export function WithPagination() {
  return withRouter(
    <div className="w-full max-w-3xl">
      <EnhancedDataTable
        data={data.slice(0, 3)}
        columns={columns}
        pageIndex={1}
        pageSize={3}
        pageCount={4}
        onPaginationChange={() => {}}
        noResultsMessage="No episodes found."
      />
    </div>,
  );
}
