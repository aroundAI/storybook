import { withI18n } from '../../lib/i18n/with-i18n';
import { DocsContent } from './components/docs-content';
import { DocsHeader } from './components/docs-header';
import { DocsSidebar } from './components/docs-sidebar';

type ComponentDocsPageProps = {
  searchParams: Promise<{
    component: string;
    category: string;
  }>;
};

async function ComponentDocsPage(props: ComponentDocsPageProps) {
  let { component, category } = await props.searchParams;

  if (!component) {
    component = 'Input';
  }

  return (
    <div className="bg-background flex h-screen">
      <DocsSidebar selectedComponent={component} selectedCategory={category} />

      <div className="flex flex-1 flex-col">
        <DocsHeader selectedComponent={component} />
        <DocsContent selectedComponent={component} />
      </div>
    </div>
  );
}

export default withI18n(ComponentDocsPage);
