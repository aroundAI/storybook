import { SidebarProvider } from '@kit/ui/shadcn-sidebar';

import { createI18nServerInstance } from '~/lib/i18n/i18n.server';

// local imports
import { DocsNavigation } from './_components/docs-navigation';
import { getDocs } from './_lib/server/docs.loader';
import { buildDocumentationTree } from './_lib/utils';

async function DocsLayout({ children }: React.PropsWithChildren) {
  const { resolvedLanguage } = await createI18nServerInstance();
  const docs = await getDocs(resolvedLanguage);
  const tree = buildDocumentationTree(docs);

  return (
    <SidebarProvider
      style={{ '--sidebar-width': '18em' } as React.CSSProperties}
      className={'h-[calc(100vh-72px)] overflow-y-hidden lg:container'}
    >
      <DocsNavigation pages={tree} />

      {children}
    </SidebarProvider>
  );
}

export default DocsLayout;
